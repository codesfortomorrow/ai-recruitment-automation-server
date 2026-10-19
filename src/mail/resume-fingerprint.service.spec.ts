import * as fs from 'fs';
import * as path from 'path';
import { Test, TestingModule } from '@nestjs/testing';
import { ResumeFingerprintService } from './resume-fingerprint.service';
import { RedisService } from '../redis';

describe('ResumeFingerprintService', () => {
  let service: ResumeFingerprintService;
  let redisStorage: Map<string, any>;
  let redisSets: Map<string, Set<string>>;
  const testStorageFile = path.resolve(
    process.cwd(),
    'data',
    'resume-fingerprints.test.json',
  );

  const mockRedisClient = {
    set: jest.fn(async (key: string, val: string, ...args: any[]) => {
      if (args.includes('NX')) {
        if (redisStorage.has(key)) return null;
      }
      redisStorage.set(key, val);
      return 'OK';
    }),
    get: jest.fn(async (key: string) => {
      return redisStorage.get(key) || null;
    }),
    del: jest.fn(async (key: string) => {
      const existed = redisStorage.delete(key);
      return existed ? 1 : 0;
    }),
    sadd: jest.fn(async (key: string, val: string) => {
      if (!redisSets.has(key)) redisSets.set(key, new Set());
      redisSets.get(key)!.add(val);
      return 1;
    }),
    sismember: jest.fn(async (key: string, val: string) => {
      const set = redisSets.get(key);
      return set && set.has(val) ? 1 : 0;
    }),
    eval: jest.fn(
      async (script: string, numKeys: number, key: string, token: string) => {
        if (redisStorage.get(key) === token) {
          redisStorage.delete(key);
          return 1;
        }
        return 0;
      },
    ),
  };

  const mockRedisService = {
    client: mockRedisClient,
  };

  beforeEach(async () => {
    redisStorage = new Map();
    redisSets = new Map();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResumeFingerprintService,
        {
          provide: RedisService,
          useValue: mockRedisService,
        },
      ],
    }).compile();

    service = module.get<ResumeFingerprintService>(ResumeFingerprintService);
    // Point to isolated test storage file
    (service as any).storageFilePath = testStorageFile;

    // Clean up test file if present
    if (fs.existsSync(testStorageFile)) {
      fs.unlinkSync(testStorageFile);
    }
  });

  afterEach(() => {
    if (fs.existsSync(testStorageFile)) {
      try {
        fs.unlinkSync(testStorageFile);
      } catch {}
    }
  });

  describe('computeFingerprint', () => {
    it('should generate consistent normalized SHA-256 hex string for identical buffer', () => {
      const buffer1 = Buffer.from('Resume content for Alice');
      const buffer2 = Buffer.from('Resume content for Alice');
      const fp1 = service.computeFingerprint(buffer1);
      const fp2 = service.computeFingerprint(buffer2);

      expect(fp1).toBe(fp2);
      expect(fp1).toHaveLength(64);
      expect(fp1).toBe(fp1.toLowerCase());
    });

    it('should generate distinct fingerprints for different buffer contents (different resumes)', () => {
      const buffer1 = Buffer.from('Resume content for Alice');
      const buffer2 = Buffer.from('Updated resume content for Alice v2');

      const fp1 = service.computeFingerprint(buffer1);
      const fp2 = service.computeFingerprint(buffer2);

      expect(fp1).not.toBe(fp2);
    });

    it('should throw an error for empty buffer', () => {
      expect(() => service.computeFingerprint(Buffer.alloc(0))).toThrow(
        'Cannot compute fingerprint of empty buffer',
      );
    });
  });

  describe('Persistence across restarts and storage recovery', () => {
    it('should persist fingerprint to file storage and reload upon module initialization (server restart)', async () => {
      const buffer = Buffer.from('Original candidate resume bytes');
      const fp = service.computeFingerprint(buffer);

      // Save fingerprint
      await service.markFingerprintProcessed(fp, {
        candidateId: 101,
        gmailMessageId: 'msg-001',
        attachmentId: 'att-001',
        filename: 'resume.pdf',
        senderEmail: 'alice@example.com',
        processedAt: new Date().toISOString(),
        status: 'COMPLETED',
      });

      // Verify file was written
      expect(fs.existsSync(testStorageFile)).toBe(true);
      const fileContent = JSON.parse(fs.readFileSync(testStorageFile, 'utf-8'));
      expect(fileContent).toHaveLength(1);
      expect(fileContent[0].fingerprint).toBe(fp);

      // Simulate a server restart by creating a new service instance with clear memory and empty Redis
      redisSets.clear();
      redisStorage.clear();

      const newService = new ResumeFingerprintService(
        mockRedisService as unknown as RedisService,
      );
      (newService as any).storageFilePath = testStorageFile;

      // Before onModuleInit, in-memory cache is empty
      expect((newService as any).memoryCache.has(fp)).toBe(false);

      // Initialize module (simulating restart)
      await newService.onModuleInit();

      // Should now detect fingerprint as processed from seeded Redis/memory
      const isProcessed = await newService.isFingerprintProcessed(fp);
      expect(isProcessed).toBe(true);
      expect(redisSets.get('recruitment:resume:fingerprints')?.has(fp)).toBe(
        true,
      );
    });
  });

  describe('Atomic distributed locking and concurrency safety', () => {
    it('should allow only one concurrent worker to acquire the lock for the same fingerprint', async () => {
      const fp = service.computeFingerprint(
        Buffer.from('Concurrent test resume'),
      );

      const worker1 = await service.acquireProcessingLock(fp);
      expect(worker1.acquired).toBe(true);
      expect(worker1.lockToken).toBeDefined();

      // Second worker attempting concurrently must be rejected
      const worker2 = await service.acquireProcessingLock(fp);
      expect(worker2.acquired).toBe(false);
      expect(worker2.lockToken).toBeUndefined();

      // Release lock with worker 1 token
      await service.releaseProcessingLock(fp, worker1.lockToken);

      // Now worker 2 (or a subsequent retry) can acquire it
      const worker3 = await service.acquireProcessingLock(fp);
      expect(worker3.acquired).toBe(true);
      expect(worker3.lockToken).toBeDefined();

      await service.releaseProcessingLock(fp, worker3.lockToken);
    });

    it('should not allow releasing a lock with an invalid token', async () => {
      const fp = service.computeFingerprint(Buffer.from('Token lock test'));
      const worker1 = await service.acquireProcessingLock(fp);

      // Attempt release with wrong token
      await service.releaseProcessingLock(fp, 'wrong-token-123');

      // Lock should still be held
      const worker2 = await service.acquireProcessingLock(fp);
      expect(worker2.acquired).toBe(false);

      // Release with correct token
      await service.releaseProcessingLock(fp, worker1.lockToken);
      const worker3 = await service.acquireProcessingLock(fp);
      expect(worker3.acquired).toBe(true);
    });
  });

  describe('Failure and retry safety', () => {
    it('should allow retry if first attempt fails before marking as COMPLETED', async () => {
      const fp = service.computeFingerprint(
        Buffer.from('Retryable resume bytes'),
      );

      // First attempt acquires lock
      const lock1 = await service.acquireProcessingLock(fp);
      expect(lock1.acquired).toBe(true);

      // Simulate failure: release lock without calling markFingerprintProcessed
      await service.releaseProcessingLock(fp, lock1.lockToken);

      // Not marked as processed
      const isProcessed1 = await service.isFingerprintProcessed(fp);
      expect(isProcessed1).toBe(false);

      // Retry attempt acquires lock and succeeds
      const lock2 = await service.acquireProcessingLock(fp);
      expect(lock2.acquired).toBe(true);

      await service.markFingerprintProcessed(fp, {
        candidateId: 102,
        gmailMessageId: 'msg-002',
        filename: 'cv.pdf',
        processedAt: new Date().toISOString(),
        status: 'COMPLETED',
      });
      await service.releaseProcessingLock(fp, lock2.lockToken);

      // Now it is marked as processed
      const isProcessed2 = await service.isFingerprintProcessed(fp);
      expect(isProcessed2).toBe(true);
    });
  });
});
