import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { JwtService } from '@nestjs/jwt';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma';
import { UserType } from '@Common';

describe('Recruitment API & Workflows (e2e)', () => {
  let app: INestApplication<App>;
  let jwtService: JwtService;
  let adminToken: string;
  let userToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.enableShutdownHooks();
    await app.init();

    const prisma = app.get(PrismaService);
    const testUser = await prisma.user.upsert({
      where: { email: 'e2e-regular-user@example.com' },
      update: { status: 'Active' },
      create: {
        firstname: 'Regular',
        lastname: 'Staff',
        email: 'e2e-regular-user@example.com',
        status: 'Active',
      },
    });

    jwtService = app.get<JwtService>(JwtService);
    adminToken = jwtService.sign({ sub: 1, type: UserType.Admin });
    userToken = jwtService.sign({ sub: testUser.id, type: UserType.User });
  });

  afterAll(async () => {
    try {
      const prisma = app.get(PrismaService);
      await prisma.user.deleteMany({
        where: { email: 'e2e-regular-user@example.com' },
      });
    } catch {
      // ignore cleanup errors
    }
    await app.close();
  });

  describe('1. Health & Routing Baseline', () => {
    it('/ (GET) returns 404', () => {
      return request(app.getHttpServer()).get('/').expect(404);
    });
  });

  describe('2. Authentication & Authorization Security Enforcements', () => {
    it('should reject unauthenticated access to Google Sheets status with 401', () => {
      return request(app.getHttpServer())
        .get('/candidates/google-sheets/status')
        .expect(401);
    });

    it('should reject unauthenticated access to pending Google Sheets sync with 401', () => {
      return request(app.getHttpServer())
        .get('/candidates/google-sheets/pending-sync')
        .expect(401);
    });

    it('should reject unauthenticated access to ambiguous email review queue with 401', () => {
      return request(app.getHttpServer())
        .get('/mail/review/ambiguous')
        .expect(401);
    });

    it('should reject non-admin users from triggering retry-pending with 403 Forbidden', () => {
      return request(app.getHttpServer())
        .post('/candidates/google-sheets/retry-pending')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(403);
    });

    it('should reject non-admin users from accessing ambiguous mail review queue with 403 Forbidden', () => {
      return request(app.getHttpServer())
        .get('/mail/review/ambiguous')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(403);
    });
  });

  describe('3. Google Sheets Recovery & Status Inspection', () => {
    it('should return safe Google Sheets status without exposing private keys or tokens', async () => {
      const response = await request(app.getHttpServer())
        .get('/candidates/google-sheets/status')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('configured');
      expect(response.body).toHaveProperty('required', true);
      expect(response.body).toHaveProperty('spreadsheetId');
      expect(response.body).toHaveProperty('configurationIssue');
      // Must not leak private credentials in response body
      expect(JSON.stringify(response.body)).not.toContain('private_key');
      expect(JSON.stringify(response.body)).not.toContain('client_secret');
    });

    it('should list pending Google Sheets synchronizations for Admin', async () => {
      const response = await request(app.getHttpServer())
        .get('/candidates/google-sheets/pending-sync')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('count');
      expect(response.body).toHaveProperty('pendingIds');
      expect(Array.isArray(response.body.pendingIds)).toBe(true);
    });

    it('should handle retry-pending gracefully when Google Sheets credentials are not active', async () => {
      const response = await request(app.getHttpServer())
        .post('/candidates/google-sheets/retry-pending')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('succeeded');
      expect(response.body).toHaveProperty('failed');
    });
  });

  describe('4. Ambiguous Email Review Queue', () => {
    it('should allow Admin to retrieve ambiguous email review queue', async () => {
      const response = await request(app.getHttpServer())
        .get('/mail/review/ambiguous')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('total');
      expect(response.body).toHaveProperty('ambiguousEmails');
      expect(Array.isArray(response.body.ambiguousEmails)).toBe(true);
    });
  });
});
