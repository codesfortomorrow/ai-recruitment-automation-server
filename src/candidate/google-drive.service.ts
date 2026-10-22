import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { Readable } from 'stream';
import { google, drive_v3 } from 'googleapis';
import {
  forwardRef,
  Inject,
  Injectable,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BaseService } from '@Common';
import { googleDriveConfigFactory } from '@Config';
import { RedisService } from '../redis';
import { GmailService } from '../mail/gmail.service';
import { ResumeScreeningQueueService } from '../mail/resume-screening-queue.service';
import { ResumeScreeningWorkerService } from '../mail/resume-screening-worker.service';
import { ResumeFingerprintService } from '../mail/resume-fingerprint.service';
import { RoleDetectionService } from '../mail/role-detection.service';
import { GoogleSheetsService } from './google-sheets.service';
import { CandidateNotificationService } from './candidate-notification.service';
import { CanonicalRole } from './candidate.types';

export interface DriveUploadOptions {
  buffer: Buffer;
  filename: string;
  mimeType?: string;
  candidateId?: number | string;
  candidateEmail?: string;
  candidateName?: string;
  role?: string | null;
  canonicalRole?: CanonicalRole | null;
}

export interface DriveUploadResult {
  fileId: string;
  webViewLink: string;
  cvLink: string; // Hyperlink formula for Google Sheets: =HYPERLINK("...", "View CV")
  filename: string;
  alreadyExisted: boolean;
  folderKey?: 'ROOT' | 'REACT' | 'NODE' | 'HR' | 'DEVOPPS';
  folderId?: string;
}

export interface DriveCvFile {
  fileId: string;
  name: string;
  mimeType: string;
  size?: number;
  createdTime?: string;
  webViewLink?: string;
  parentFolderId?: string;
}

@Injectable()
export class GoogleDriveService extends BaseService implements OnModuleInit {
  private drive: drive_v3.Drive | null = null;
  private resolvedFolderId: string | null = null;
  private static readonly REDIS_PROCESSED_FILE_PREFIX =
    'recruitment:drive:processed:file:';
  private static readonly REDIS_DRIVE_SCAN_LOCK = 'lock:recruitment:drive:scan';
  private static readonly MAX_RETRIES = 3;

  constructor(
    @Inject(googleDriveConfigFactory.KEY)
    private readonly config: ConfigType<typeof googleDriveConfigFactory>,
    private readonly redisService: RedisService,
    @Optional()
    @Inject(forwardRef(() => GmailService))
    private readonly gmailService?: GmailService,
    @Optional()
    @Inject(forwardRef(() => ResumeScreeningQueueService))
    private readonly queueService?: ResumeScreeningQueueService,
    @Optional()
    @Inject(forwardRef(() => ResumeScreeningWorkerService))
    private readonly workerService?: ResumeScreeningWorkerService,
    @Optional()
    @Inject(forwardRef(() => ResumeFingerprintService))
    private readonly fingerprintService?: ResumeFingerprintService,
    @Optional()
    @Inject(forwardRef(() => RoleDetectionService))
    private readonly roleDetectionService?: RoleDetectionService,
    @Optional()
    @Inject(forwardRef(() => GoogleSheetsService))
    private readonly googleSheetsService?: GoogleSheetsService,
    @Optional()
    @Inject(forwardRef(() => CandidateNotificationService))
    private readonly notificationService?: CandidateNotificationService,
  ) {
    super({
      loggerDefaultMeta: { service: GoogleDriveService.name },
    });
  }

  async onModuleInit(): Promise<void> {
    if (this.isConfigured()) {
      try {
        await this.ensureCvFolder();
      } catch (err: any) {
        this.logger.warn(
          `Failed to initialize or locate Google Drive CV folder on startup: ${this.sanitizeError(err)}`,
        );
      }
    }
  }

  /**
   * Returns whether Google Drive service account key file is present and valid.
   */
  public isConfigured(): boolean {
    return this.getConfigurationIssue() === '';
  }

  /**
   * Validates configuration without exposing secrets.
   */
  public getConfigurationIssue(): string {
    if (!this.config.keyFile || !this.config.keyFile.trim()) {
      return 'GOOGLE_DRIVE_KEY_FILE / GOOGLE_SHEETS_KEY_FILE is missing or empty';
    }

    const resolvedKeyPath = path.isAbsolute(this.config.keyFile)
      ? this.config.keyFile
      : path.resolve(process.cwd(), this.config.keyFile);

    if (!fs.existsSync(resolvedKeyPath)) {
      return `Service Account key file not found at path "${resolvedKeyPath}"`;
    }

    try {
      const stats = fs.statSync(resolvedKeyPath);
      if (!stats.isFile()) {
        return `Path "${resolvedKeyPath}" is a directory, not a valid service account JSON file`;
      }
      const raw = fs.readFileSync(resolvedKeyPath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (
        parsed.type !== 'service_account' ||
        !parsed.project_id ||
        !parsed.private_key ||
        !parsed.client_email
      ) {
        return `Service account JSON file is missing required fields (type, project_id, private_key, or client_email)`;
      }
    } catch (parseErr: any) {
      return `Failed to read or parse service account JSON file: ${parseErr.message}`;
    }

    return '';
  }

  /**
   * Returns the service account client_email without exposing private keys.
   */
  public getServiceAccountEmail(): string | null {
    if (!this.config.keyFile) return null;
    const resolvedKeyPath = path.isAbsolute(this.config.keyFile)
      ? this.config.keyFile
      : path.resolve(process.cwd(), this.config.keyFile);
    if (!fs.existsSync(resolvedKeyPath)) return null;
    try {
      const raw = fs.readFileSync(resolvedKeyPath, 'utf-8');
      const parsed = JSON.parse(raw);
      return parsed.client_email || null;
    } catch {
      return null;
    }
  }

  /**
   * Formats Google Drive permission errors with actionable guidance.
   */
  public formatDriveFolderError(
    folderId: string,
    folderName: string,
    originalError: any,
  ): Error {
    const msg = originalError?.message || String(originalError);
    if (msg.includes('File not found') || msg.includes('notFound')) {
      const saEmail = this.getServiceAccountEmail();
      return new Error(
        `Google Drive folder "${folderName}" (${folderId}) was not found or is not accessible. Please ensure the folder is shared with Service Account: "${saEmail || 'configured in service account JSON'}" as an Editor. Cause: ${msg}`,
      );
    }
    return originalError instanceof Error ? originalError : new Error(msg);
  }

  /**
   * Initializes and caches the google.drive v3 client.
   */
  public getClient(): drive_v3.Drive | null {
    if (this.drive) {
      return this.drive;
    }

    if (!this.isConfigured()) {
      return null;
    }

    try {
      const resolvedKeyPath = path.isAbsolute(this.config.keyFile)
        ? this.config.keyFile
        : path.resolve(process.cwd(), this.config.keyFile);

      const auth = new google.auth.GoogleAuth({
        keyFile: resolvedKeyPath,
        scopes: [
          'https://www.googleapis.com/auth/drive',
          'https://www.googleapis.com/auth/drive.file',
        ],
      });

      this.drive = google.drive({ version: 'v3', auth });
      return this.drive;
    } catch (err: any) {
      this.logger.error(
        `Failed to initialize Google Drive client: ${this.sanitizeError(err)}`,
      );
      return null;
    }
  }

  /**
   * Returns a list of required folder environment variable names that are missing or empty.
   */
  public getMissingFolderConfig(): string[] {
    const missing: string[] = [];
    const rootId =
      this.config.rootFolderId?.trim() ||
      this.config.folderId?.trim() ||
      (this.config as any).cvFolderId?.trim();
    if (!rootId) missing.push('GOOGLE_DRIVE_ROOT_FOLDER_ID');
    if (!this.config.reactFolderId?.trim())
      missing.push('GOOGLE_DRIVE_REACT_FOLDER_ID');
    if (!this.config.nodeFolderId?.trim())
      missing.push('GOOGLE_DRIVE_NODE_FOLDER_ID');
    if (!this.config.hrFolderId?.trim())
      missing.push('GOOGLE_DRIVE_HR_FOLDER_ID');
    if (!this.config.devoppsFolderId?.trim())
      missing.push('GOOGLE_DRIVE_DEVOPPS_FOLDER_ID');
    return missing;
  }

  /**
   * Returns current metadata and configuration status for root and child role folders.
   */
  public getConfiguredFolders(): Record<
    string,
    { name: string; folderId: string; configured: boolean; envVar: string }
  > {
    const rootId =
      this.config.rootFolderId?.trim() ||
      this.config.folderId?.trim() ||
      (this.config as any).cvFolderId?.trim() ||
      '';
    return {
      ROOT: {
        name: this.config.folderName || 'Central Repository of Resume',
        folderId: rootId,
        configured: Boolean(rootId),
        envVar: 'GOOGLE_DRIVE_ROOT_FOLDER_ID',
      },
      REACT: {
        name: 'React',
        folderId: this.config.reactFolderId?.trim() || '',
        configured: Boolean(this.config.reactFolderId?.trim()),
        envVar: 'GOOGLE_DRIVE_REACT_FOLDER_ID',
      },
      NODE: {
        name: 'Node',
        folderId: this.config.nodeFolderId?.trim() || '',
        configured: Boolean(this.config.nodeFolderId?.trim()),
        envVar: 'GOOGLE_DRIVE_NODE_FOLDER_ID',
      },
      HR: {
        name: 'HR',
        folderId: this.config.hrFolderId?.trim() || '',
        configured: Boolean(this.config.hrFolderId?.trim()),
        envVar: 'GOOGLE_DRIVE_HR_FOLDER_ID',
      },
      DEVOPPS: {
        name: 'Devopps',
        folderId: this.config.devoppsFolderId?.trim() || '',
        configured: Boolean(this.config.devoppsFolderId?.trim()),
        envVar: 'GOOGLE_DRIVE_DEVOPPS_FOLDER_ID',
      },
    };
  }

  /**
   * Returns the display name for a folder key.
   */
  public getFolderNameForKey(
    folderKey: 'ROOT' | 'REACT' | 'NODE' | 'HR' | 'DEVOPPS',
  ): string {
    switch (folderKey) {
      case 'REACT':
        return 'React';
      case 'NODE':
        return 'Node';
      case 'HR':
        return 'HR';
      case 'DEVOPPS':
        return 'Devopps';
      case 'ROOT':
      default:
        return this.config.folderName || 'Central Repository of Resume';
    }
  }

  /**
   * Maps candidate role to the appropriate existing Google Drive folder.
   *
   * Initial mapping:
   * - React Developer / React.js Developer -> React
   * - Node.js Developer / Node Developer -> Node
   * - HR / Recruiter / Talent Acquisition -> HR
   * - DevOps Engineer -> Devopps
   *
   * If role is ambiguous, conflicting, or unsupported, keeps CV in Root (Central Repository of Resume)
   * and marks candidate for manual review without guessing destination.
   * Strict guard: Java developer must NEVER match JavaScript or Node.
   */
  public resolveRoleFolder(
    roleOrTitle?: string | null,
    canonicalRole?: CanonicalRole | null,
  ): {
    folderKey: 'ROOT' | 'REACT' | 'NODE' | 'HR' | 'DEVOPPS';
    folderName: string;
    isConfident: boolean;
  } {
    // 1. Check custom overrides from config
    if (this.config.roleFolders && (roleOrTitle || canonicalRole)) {
      const customKey =
        (canonicalRole && this.config.roleFolders[canonicalRole]) ||
        (roleOrTitle && this.config.roleFolders[roleOrTitle]);
      if (customKey) {
        const upper = customKey.toUpperCase() as any;
        if (['ROOT', 'REACT', 'NODE', 'HR', 'DEVOPPS'].includes(upper)) {
          return {
            folderKey: upper,
            folderName: this.getFolderNameForKey(upper),
            isConfident: true,
          };
        }
      }
    }

    const norm = (roleOrTitle || '').toLowerCase().trim();

    // 2. Strict guard: Check if conflicting or ambiguous
    if (
      !roleOrTitle ||
      /\bconflict\b/i.test(norm) ||
      /\bambiguous\b/i.test(norm) ||
      /\bundetected\b/i.test(norm) ||
      /\bunspecified\b/i.test(norm)
    ) {
      return {
        folderKey: 'ROOT',
        folderName: 'Central Repository of Resume',
        isConfident: false,
      };
    }

    // 3. Strict guard: Java Developer must NEVER be classified as JavaScript / Node / React!
    const isJava =
      /\bjava\b/i.test(norm) && !/\b(javascript|js|node|react)\b/i.test(norm);
    if (isJava) {
      return {
        folderKey: 'ROOT',
        folderName: 'Central Repository of Resume',
        isConfident: false,
      };
    }

    // 4. React Developer
    if (
      canonicalRole === 'REACT_DEVELOPER' ||
      /\breact(?:\.js|js)?\b/i.test(norm)
    ) {
      // Guard: If it says React AND Node (e.g. MERN), keep in Root for manual review
      if (/\bnode(?:\.js|js)?\b/i.test(norm) || /\bmern\b/i.test(norm)) {
        return {
          folderKey: 'ROOT',
          folderName: 'Central Repository of Resume',
          isConfident: false,
        };
      }
      return {
        folderKey: 'REACT',
        folderName: 'React',
        isConfident: true,
      };
    }

    // 5. Node Developer
    if (
      canonicalRole === 'NODE_DEVELOPER' ||
      (/\bnode(?:\.js|js)?\b/i.test(norm) && !isJava)
    ) {
      return {
        folderKey: 'NODE',
        folderName: 'Node',
        isConfident: true,
      };
    }

    // 6. HR / Recruiter / Talent Acquisition
    if (
      canonicalRole === 'HR_INTERN' ||
      canonicalRole === 'HR_EXECUTIVE' ||
      canonicalRole === 'RECRUITER' ||
      canonicalRole === 'TALENT_ACQUISITION' ||
      /\b(?:hr|human\s+resources|recruiter|talent\s+acquisition)\b/i.test(norm)
    ) {
      return {
        folderKey: 'HR',
        folderName: 'HR',
        isConfident: true,
      };
    }

    // 7. DevOps Engineer
    if (
      canonicalRole === 'DEVOPS_ENGINEER' ||
      /\b(?:devops|devopps|sre|site\s+reliability\s+engineer)\b/i.test(norm)
    ) {
      return {
        folderKey: 'DEVOPPS',
        folderName: 'Devopps',
        isConfident: true,
      };
    }

    // 8. Unsupported roles (e.g. Python Developer, QA Tester, Business Analyst, etc.)
    return {
      folderKey: 'ROOT',
      folderName: 'Central Repository of Resume',
      isConfident: false,
    };
  }

  /**
   * Retrieves the configured folder ID for a folder key.
   * Never creates replacement folders or guesses IDs.
   */
  public getFolderId(
    folderKey: 'ROOT' | 'REACT' | 'NODE' | 'HR' | 'DEVOPPS' = 'ROOT',
  ): string {
    switch (folderKey) {
      case 'REACT': {
        const id = this.config.reactFolderId?.trim();
        if (!id) {
          throw new Error(
            'Google Drive folder ID missing: GOOGLE_DRIVE_REACT_FOLDER_ID is required for React folder',
          );
        }
        return id;
      }
      case 'NODE': {
        const id = this.config.nodeFolderId?.trim();
        if (!id) {
          throw new Error(
            'Google Drive folder ID missing: GOOGLE_DRIVE_NODE_FOLDER_ID is required for Node folder',
          );
        }
        return id;
      }
      case 'HR': {
        const id = this.config.hrFolderId?.trim();
        if (!id) {
          throw new Error(
            'Google Drive folder ID missing: GOOGLE_DRIVE_HR_FOLDER_ID is required for HR folder',
          );
        }
        return id;
      }
      case 'DEVOPPS': {
        const id = this.config.devoppsFolderId?.trim();
        if (!id) {
          throw new Error(
            'Google Drive folder ID missing: GOOGLE_DRIVE_DEVOPPS_FOLDER_ID is required for Devopps folder',
          );
        }
        return id;
      }
      case 'ROOT':
      default: {
        const id =
          this.config.rootFolderId?.trim() ||
          this.config.folderId?.trim() ||
          (this.config as any).cvFolderId?.trim();
        if (!id) {
          throw new Error(
            'Google Drive folder ID missing: GOOGLE_DRIVE_ROOT_FOLDER_ID is required for Central Repository of Resume',
          );
        }
        return id;
      }
    }
  }

  /**
   * Returns the verified folder ID for the specified folder key.
   * Uses existing folders without creating replacement folders.
   */
  public async ensureCvFolder(
    folderType: 'ROOT' | 'REACT' | 'NODE' | 'HR' | 'DEVOPPS' = 'ROOT',
  ): Promise<string> {
    const client = this.getClient();
    if (!client) {
      throw new Error('Google Drive client is not configured');
    }

    return this.getFolderId(folderType);
  }

  /**
   * Uploads a candidate CV to the appropriate Google Drive folder based on role.
   * If a file with the same candidateId or identical unique name already exists in target folder, reuses it.
   */
  public async uploadCv(
    options: DriveUploadOptions & {
      role?: string | null;
      canonicalRole?: CanonicalRole | null;
    },
  ): Promise<DriveUploadResult> {
    const client = this.getClient();
    if (!client) {
      throw new Error('Google Drive client is not configured');
    }

    const { folderKey, folderName } = this.resolveRoleFolder(
      options.role,
      options.canonicalRole,
    );
    const folderId = await this.ensureCvFolder(folderKey);
    const sanitizedFilename = this.sanitizeFilename(options.filename);
    const candidateIdStr =
      options.candidateId !== undefined && options.candidateId !== null
        ? String(options.candidateId)
        : 'New';

    const safeTargetName = `Candidate_${candidateIdStr}_${sanitizedFilename}`;

    // 1. Check for existing file in target folder to prevent duplicates
    try {
      const existingRes = await client.files.list({
        q: `'${folderId}' in parents and name = '${safeTargetName}' and trashed = false`,
        fields: 'files(id, name, webViewLink)',
        spaces: 'drive',
      });

      const existingFile = existingRes.data.files?.[0];
      if (existingFile?.id) {
        const webViewLink =
          existingFile.webViewLink ||
          `https://drive.google.com/file/d/${existingFile.id}/view`;
        const cvLink = `=HYPERLINK("${webViewLink}", "View CV")`;

        this.logger.info(
          `Reusing existing Google Drive CV file in folder "${folderName}" for Candidate ${candidateIdStr} (File ID: ${existingFile.id})`,
        );

        return {
          fileId: existingFile.id,
          webViewLink,
          cvLink,
          filename: safeTargetName,
          alreadyExisted: true,
          folderKey,
          folderId,
        };
      }
    } catch (checkErr: any) {
      this.logger.warn(
        `Failed to check for existing Drive file, proceeding with upload: ${checkErr.message}`,
      );
    }

    // 2. Upload file stream (Private permissions only; never add anyoneWithLink)
    const mimeType =
      options.mimeType ||
      (safeTargetName.toLowerCase().endsWith('.docx')
        ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        : 'application/pdf');

    const stream = new Readable();
    stream.push(options.buffer);
    stream.push(null);

    let uploadRes;
    try {
      uploadRes = await this.executeWithRetry(async () => {
        return await client.files.create({
          requestBody: {
            name: safeTargetName,
            parents: [folderId],
            description: `Resume for candidate ${candidateIdStr} (${folderName})`,
          },
          media: {
            mimeType,
            body: stream,
          },
          fields: 'id, name, webViewLink',
        });
      });
    } catch (err: any) {
      throw this.formatDriveFolderError(folderId, folderName, err);
    }

    const fileId = uploadRes.data.id;
    if (!fileId) {
      throw new Error('Google Drive API returned empty file ID on upload');
    }

    const webViewLink =
      uploadRes.data.webViewLink ||
      `https://drive.google.com/file/d/${fileId}/view`;
    const cvLink = `=HYPERLINK("${webViewLink}", "View CV")`;

    this.logger.info(
      `Successfully uploaded CV to Google Drive folder "${folderName}": "${safeTargetName}" (File ID: ${fileId})`,
      { candidateId: candidateIdStr, fileId, folderKey, folderId },
    );

    return {
      fileId,
      webViewLink,
      cvLink,
      filename: safeTargetName,
      alreadyExisted: false,
      folderKey,
      folderId,
    };
  }

  /**
   * Safely moves a CV file from one parent folder to another using its existing file ID.
   */
  public async moveCvFile(
    fileId: string,
    currentParentFolderId: string,
    targetFolderId: string,
  ): Promise<void> {
    const client = this.getClient();
    if (!client) {
      throw new Error('Google Drive client is not configured');
    }

    if (currentParentFolderId === targetFolderId) {
      return;
    }

    await this.executeWithRetry(async () => {
      return await client.files.update({
        fileId,
        addParents: targetFolderId,
        removeParents: currentParentFolderId,
        fields: 'id, parents',
      });
    });

    this.logger.info(
      `Moved Google Drive file ${fileId} from parent ${currentParentFolderId} to target folder ${targetFolderId}`,
    );
  }

  /**
   * Downloads a resume file from Google Drive as a Buffer.
   */
  public async downloadCv(
    fileId: string,
  ): Promise<{ buffer: Buffer; filename: string; mimeType: string }> {
    const client = this.getClient();
    if (!client) {
      throw new Error('Google Drive client is not configured');
    }

    // 1. Fetch file metadata
    const metaRes = await client.files.get({
      fileId,
      fields: 'id, name, mimeType',
    });

    const filename = metaRes.data.name || 'resume.pdf';
    const mimeType = metaRes.data.mimeType || 'application/pdf';

    // 2. Fetch file content as arraybuffer
    const mediaRes = await this.executeWithRetry(async () => {
      return await client.files.get(
        { fileId, alt: 'media' },
        { responseType: 'arraybuffer' },
      );
    });

    const buffer = Buffer.from(mediaRes.data as ArrayBuffer);

    return {
      buffer,
      filename,
      mimeType,
    };
  }

  /**
   * Returns list of unique configured folder descriptors to scan.
   */
  public getFoldersToScan(): {
    folderKey: 'ROOT' | 'REACT' | 'NODE' | 'HR' | 'DEVOPPS';
    folderId: string;
    folderName: string;
  }[] {
    const configured = this.getConfiguredFolders();
    const result: {
      folderKey: 'ROOT' | 'REACT' | 'NODE' | 'HR' | 'DEVOPPS';
      folderId: string;
      folderName: string;
    }[] = [];
    const seenIds = new Set<string>();

    for (const [key, details] of Object.entries(configured)) {
      if (details.configured && !seenIds.has(details.folderId)) {
        seenIds.add(details.folderId);
        result.push({
          folderKey: key as any,
          folderId: details.folderId,
          folderName: details.name,
        });
      }
    }

    return result;
  }

  /**
   * Scans configured existing folders for newly added resumes.
   * Monitored folders: Central Repository of Resume, React, Node, HR, Devopps.
   * Does NOT scan unrelated Drive folders.
   * Filters for supported PDF and DOCX files only, and excludes already-processed files by default.
   */
  public async scanNewCvFiles(options?: {
    includeProcessed?: boolean;
  }): Promise<DriveCvFile[]> {
    const client = this.getClient();
    if (!client) {
      return [];
    }

    const foldersToScan = this.getFoldersToScan();
    if (foldersToScan.length === 0) {
      return [];
    }

    const validCvFiles: DriveCvFile[] = [];
    const seenFileIds = new Set<string>();

    for (const folder of foldersToScan) {
      try {
        const query = `'${folder.folderId}' in parents and trashed = false`;
        const listRes = await this.executeWithRetry(async () => {
          return await client.files.list({
            q: query,
            fields:
              'files(id, name, mimeType, size, createdTime, webViewLink, parents)',
            pageSize: 50,
            orderBy: 'createdTime desc',
          });
        });

        const files = listRes.data.files || [];
        for (const file of files) {
          if (!file.id || !file.name) continue;

          // Deduplicate across folders so file is scanned only once
          if (seenFileIds.has(file.id)) {
            continue;
          }
          seenFileIds.add(file.id);

          const lowerName = file.name.toLowerCase();
          const lowerMime = (file.mimeType || '').toLowerCase();

          const isSupported =
            lowerName.endsWith('.pdf') ||
            lowerName.endsWith('.docx') ||
            lowerMime === 'application/pdf' ||
            lowerMime ===
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

          if (!isSupported) {
            continue;
          }

          if (!options?.includeProcessed) {
            const isProcessed = await this.isFileProcessed(file.id);
            if (isProcessed) {
              continue;
            }
          }

          validCvFiles.push({
            fileId: file.id,
            name: file.name,
            mimeType: file.mimeType || 'application/pdf',
            size: file.size ? parseInt(String(file.size), 10) : undefined,
            createdTime: file.createdTime || undefined,
            webViewLink:
              file.webViewLink ||
              `https://drive.google.com/file/d/${file.id}/view`,
            parentFolderId: folder.folderId,
          });
        }
      } catch (scanErr: any) {
        this.logger.warn(
          `Failed to scan Google Drive folder "${folder.folderName}" (${folder.folderId}): ${scanErr.message}`,
        );
      }
    }

    return validCvFiles;
  }

  /**
   * Checks whether a Drive file ID has already been marked as processed in Redis.
   */
  public async isFileProcessed(fileId: string): Promise<boolean> {
    try {
      const exists = await this.redisService.client.exists(
        `${GoogleDriveService.REDIS_PROCESSED_FILE_PREFIX}${fileId}`,
      );
      return exists === 1;
    } catch {
      return false;
    }
  }

  /**
   * Marks a Drive file ID as processed in Redis.
   */
  public async markFileProcessed(
    fileId: string,
    candidateId?: number | string,
  ): Promise<void> {
    try {
      await this.redisService.client.set(
        `${GoogleDriveService.REDIS_PROCESSED_FILE_PREFIX}${fileId}`,
        candidateId !== undefined ? String(candidateId) : '1',
        'EX',
        86400 * 90, // 90 days retention
      );
    } catch (err: any) {
      this.logger.warn(
        `Failed to mark Drive file as processed in Redis: ${err.message}`,
      );
    }
  }

  /**
   * Sanitizes a filename removing unsafe filesystem or URL characters.
   */
  public sanitizeFilename(filename: string): string {
    const base = path.basename(filename || 'resume.pdf');
    return base
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .replace(/_{2,}/g, '_')
      .slice(0, 100);
  }

  /**
   * Generates a safe clickable Google Sheets formula linking to the candidate's Google Drive CV.
   */
  public getCvHyperlink(fileIdOrUrl: string): string {
    const url = fileIdOrUrl.startsWith('http')
      ? fileIdOrUrl
      : `https://drive.google.com/file/d/${fileIdOrUrl}/view`;
    return `=HYPERLINK("${url}", "View CV")`;
  }

  /**
   * Executes an asynchronous Google Drive operation with bounded exponential backoff and jitter.
   */
  private async executeWithRetry<T>(
    operation: () => Promise<T>,
    maxRetries = GoogleDriveService.MAX_RETRIES,
  ): Promise<T> {
    let attempt = 0;
    let lastError: any;

    while (attempt < maxRetries) {
      attempt++;
      try {
        return await operation();
      } catch (err: any) {
        lastError = err;
        if (!this.isTransientError(err) || attempt >= maxRetries) {
          throw err;
        }

        const jitter = Math.floor(Math.random() * 200);
        const delayMs = Math.min(500 * Math.pow(2, attempt - 1) + jitter, 3000);
        this.logger.warn(
          `Google Drive API transient error on attempt ${attempt}/${maxRetries}: ${err.message}. Retrying in ${delayMs}ms...`,
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    throw lastError;
  }

  /**
   * Classifies whether an error is transient (retriable) vs permanent.
   */
  public isTransientError(err: any): boolean {
    const status = err?.status ?? err?.response?.status ?? err?.code;
    if ([429, 500, 502, 503, 504].includes(Number(status))) {
      return true;
    }
    const message = String(err?.message || '').toLowerCase();
    return (
      message.includes('service unavailable') ||
      message.includes('backend error') ||
      message.includes('rate limit') ||
      message.includes('user rate limit') ||
      message.includes('econnreset') ||
      message.includes('etimedout')
    );
  }

  /**
   * Sanitizes error message preventing credential leaks.
   */
  public sanitizeError(err: any): string {
    if (!err) return 'Unknown error';
    let msg = String(err.message || err);
    msg = msg.replace(
      /-----BEGIN [A-Z ]+ PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+ PRIVATE KEY-----/gi,
      '[REDACTED PRIVATE KEY]',
    );
    msg = msg.replace(/AIza[0-9A-Za-z-_]{35}/g, '[REDACTED_API_KEY]');
    return msg;
  }

  /**
   * Scans "All Candidate CVs" folder for newly uploaded CVs, downloads them,
   * checks for duplicates, extracts text, and enqueues to the unified screening pipeline.
   */
  public async pollAndProcessNewFiles(): Promise<number> {
    if (!this.isConfigured()) {
      return 0;
    }

    let lockAcquired = false;
    const lockToken = crypto.randomUUID();
    if (this.redisService?.client) {
      try {
        const res = await this.redisService.client.set(
          GoogleDriveService.REDIS_DRIVE_SCAN_LOCK,
          lockToken,
          'EX',
          60,
          'NX',
        );
        lockAcquired = res === 'OK';
        if (!lockAcquired) {
          return 0;
        }
      } catch {
        lockAcquired = true;
      }
    } else {
      lockAcquired = true;
    }

    try {
      const cvFiles = await this.scanNewCvFiles();
      let processedCount = 0;

      for (const file of cvFiles) {
        // 1. Check if already marked processed in Redis
        const isProcessed = await this.isFileProcessed(file.fileId);
        if (isProcessed) {
          continue;
        }

        // 2. Check if already recorded in Google Sheets
        if (this.googleSheetsService?.isConfigured()) {
          try {
            const rows =
              await this.googleSheetsService.readCandidateTrackerRows();
            const matchingRow = rows.find(
              (r) =>
                r.driveFileId === file.fileId ||
                (r.cvLink && r.cvLink.includes(file.fileId)),
            );
            if (matchingRow) {
              await this.markFileProcessed(
                file.fileId,
                matchingRow.candidateId,
              );
              // If notification was not sent, retry only notification
              if (
                (matchingRow as any).notificationStatus === 'PENDING' &&
                this.notificationService
              ) {
                try {
                  await this.notificationService.notifyAssignedHr(matchingRow);
                } catch {}
              }
              continue;
            }
          } catch (sheetsReadErr: any) {
            this.logger.warn(
              `Could not verify Sheets rows during Drive poll: ${sheetsReadErr.message}`,
            );
          }
        }

        // 3. Download the file
        let downloadResult: {
          buffer: Buffer;
          filename: string;
          mimeType: string;
        };
        try {
          downloadResult = await this.downloadCv(file.fileId);
        } catch (downloadErr: any) {
          this.logger.warn(
            `Failed to download Drive file ${file.fileId} (${file.name}): ${downloadErr.message}`,
          );
          continue;
        }

        const { buffer } = downloadResult;

        // 4. Validate resume buffer integrity via magic bytes
        const isPdf =
          buffer.length >= 5 &&
          buffer.subarray(0, 5).toString('ascii') === '%PDF-';
        const isDocx =
          buffer.length >= 4 &&
          buffer[0] === 0x50 &&
          buffer[1] === 0x4b &&
          buffer[2] === 0x03 &&
          buffer[3] === 0x04;

        if (!isPdf && !isDocx) {
          this.logger.warn(
            `Drive file ${file.name} (${file.fileId}) failed buffer format validation; routing to manual review`,
          );
          await this.markFileProcessed(file.fileId);
          continue;
        }

        // 5. Extract resume text
        let extractedText = '';
        if (this.gmailService) {
          const extraction = await this.gmailService.extractResumeText(buffer);
          extractedText = extraction.text || '';
        }

        // 6. Extract candidate email if present in resume text
        const emailMatch = extractedText.match(
          /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/,
        );
        const applicantEmail = emailMatch
          ? emailMatch[0].toLowerCase()
          : undefined;

        // 7. Compute fingerprint and check for duplicates (per applicant email)
        const fingerprint = this.fingerprintService
          ? this.fingerprintService.computeFingerprint(buffer)
          : crypto.createHash('sha256').update(buffer).digest('hex');

        if (this.fingerprintService) {
          const isFpProcessed =
            await this.fingerprintService.isFingerprintProcessed(
              fingerprint,
              applicantEmail,
            );
          if (isFpProcessed) {
            this.logger.info(
              `Drive file ${file.name} has identical fingerprint for applicant ${applicantEmail || 'unknown'}; marking processed`,
              { fileId: file.fileId, fingerprint },
            );
            await this.markFileProcessed(file.fileId);
            continue;
          }
        }

        // 8. Detect job role with folder context
        let folderContextRole: string | undefined;
        if (file.parentFolderId) {
          if (file.parentFolderId === this.config.reactFolderId?.trim()) {
            folderContextRole = 'React.js Developer';
          } else if (file.parentFolderId === this.config.nodeFolderId?.trim()) {
            folderContextRole = 'Node.js Developer';
          } else if (file.parentFolderId === this.config.hrFolderId?.trim()) {
            folderContextRole = 'HR';
          } else if (
            file.parentFolderId === this.config.devoppsFolderId?.trim()
          ) {
            folderContextRole = 'DevOps Engineer';
          }
        }

        const roleResolution = this.roleDetectionService
          ? this.roleDetectionService.detectRole({
              subject: file.name,
              body: extractedText,
              metadataRole: folderContextRole,
            })
          : {
              status: 'AMBIGUOUS' as const,
              detectedRole: undefined,
              appliedRole: 'Undetected Role',
            };

        // 9. Root-to-child folder movement:
        // When a CV is in the root folder but its role is confidently identified,
        // move it to the appropriate existing child folder using the existing file ID.
        // Do not move ambiguous or unsupported resumes automatically.
        // When an uploaded file is already in the correct role folder, reuse existing file.
        const rootFolderId =
          this.config.rootFolderId?.trim() ||
          this.config.folderId?.trim() ||
          (this.config as any).cvFolderId?.trim();

        const targetResolution = this.resolveRoleFolder(
          roleResolution.detectedRole || roleResolution.appliedRole,
        );

        if (
          file.parentFolderId &&
          rootFolderId &&
          file.parentFolderId === rootFolderId
        ) {
          if (
            targetResolution.folderKey !== 'ROOT' &&
            targetResolution.isConfident &&
            roleResolution.status === 'RESOLVED'
          ) {
            try {
              const targetFolderId = this.getFolderId(
                targetResolution.folderKey,
              );
              if (targetFolderId && targetFolderId !== rootFolderId) {
                await this.moveCvFile(
                  file.fileId,
                  rootFolderId,
                  targetFolderId,
                );
                this.logger.info(
                  `Moved CV "${file.name}" (File ID: ${file.fileId}) from Root to "${targetResolution.folderName}" folder (${targetFolderId})`,
                );
              }
            } catch (moveErr: any) {
              this.logger.warn(
                `Failed to move CV "${file.name}" to child folder: ${moveErr.message}`,
              );
            }
          } else {
            this.logger.info(
              `CV "${file.name}" in root folder has ambiguous or unmapped role; keeping in Central Repository of Resume for manual review`,
            );
          }
        }

        const cvLink = `=HYPERLINK("https://drive.google.com/file/d/${file.fileId}/view", "View CV")`;

        // 10. Enqueue to unified screening queue
        if (this.queueService) {
          const job = await this.queueService.enqueueJob({
            fingerprint,
            messageId: `drive:${file.fileId}`,
            attachmentId: file.fileId,
            filename: file.name,
            mimeType: file.mimeType,
            fileSize: file.size,
            sender: {
              name: 'Drive Upload',
              email: applicantEmail || 'drive-upload@recruitment.local',
            },
            subject: `Drive Manual CV: ${file.name}`,
            receivedDate: file.createdTime
              ? new Date(file.createdTime)
              : new Date(),
            emailBody: `Candidate CV uploaded manually to Google Drive: ${file.name}`,
            extractedResumeText: extractedText,
            jobRole:
              roleResolution.status === 'RESOLVED'
                ? roleResolution.detectedRole
                : undefined,
            driveFileId: file.fileId,
            cvLink,
            source: 'DRIVE_MANUAL',
          });

          // Mark processed in Redis so subsequent polls won't re-enqueue
          await this.markFileProcessed(file.fileId);
          processedCount++;

          this.logger.info(
            `Enqueued manually uploaded Drive CV ${file.name} (File ID: ${file.fileId}) into unified screening queue (Job ID: ${job.id})`,
          );

          // If workerService is available, trigger processing
          if (this.workerService) {
            try {
              await this.workerService.processSingleJob(job);
            } catch (workErr: any) {
              this.logger.error(
                `Failed to execute screening for Drive job ${job.id}: ${workErr.message}`,
              );
            }
          }
        }
      }

      return processedCount;
    } finally {
      if (this.redisService?.client && lockAcquired) {
        try {
          const current = await this.redisService.client.get(
            GoogleDriveService.REDIS_DRIVE_SCAN_LOCK,
          );
          if (current === lockToken) {
            await this.redisService.client.del(
              GoogleDriveService.REDIS_DRIVE_SCAN_LOCK,
            );
          }
        } catch {}
      }
    }
  }

  /**
   * Scheduled cron checking the "All Candidate CVs" Google Drive folder.
   */
  @Cron(CronExpression.EVERY_30_SECONDS)
  async scheduledPoll(): Promise<void> {
    if (!this.config.pollingEnabled) {
      return;
    }
    if (!this.isConfigured()) {
      return;
    }
    try {
      await this.pollAndProcessNewFiles();
    } catch (err: any) {
      this.logger.warn(
        `Google Drive polling error: ${this.sanitizeError(err)}`,
      );
    }
  }

  /**
   * Reports whether background Drive folder polling is enabled at runtime.
   */
  public isPollingEnabled(): boolean {
    return Boolean(this.config?.pollingEnabled);
  }
}
