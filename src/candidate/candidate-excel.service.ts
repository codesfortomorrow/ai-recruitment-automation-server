import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import ExcelJS from 'exceljs';
import { forwardRef, Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BaseService } from '@Common';
import { excelSyncConfigFactory, hrConfigFactory } from '@Config';
import { PrismaService } from '../prisma';
import { RedisService } from '../redis';
import { HrAssignmentService } from './hr-assignment.service';
import { CandidateNotificationService } from './candidate-notification.service';
import { ExcelSyncStatus, ExcelSyncTrigger } from '../generated/prisma/client';
import { CandidateQueryDto } from './dto/candidate-query.dto';
import {
  CandidateStatsResponse,
  ExcelCandidateRecord,
  ExcelRowError,
  ExcelSyncResult,
  SaveCandidateInput,
} from './candidate.types';

// Re-export candidate types for full backwards compatibility
export type {
  ExcelRowError,
  ExcelSyncResult,
  SaveCandidateInput,
  ExcelCandidateRecord,
};

@Injectable()
export class CandidateExcelService extends BaseService implements OnModuleInit {
  private isSyncInProgress = false;
  private lastScheduledRunAt = 0;
  private static readonly REDIS_LOCK_KEY = 'lock:candidate-excel-persistence';
  private static readonly REDIS_LOCK_TTL_SECONDS = 120;

  // In-process write lock queue to ensure serial workbook access across concurrent requests
  private fileWriteQueue: Promise<any> = Promise.resolve();

  constructor(
    @Inject(excelSyncConfigFactory.KEY)
    private readonly config: ConfigType<typeof excelSyncConfigFactory>,
    @Inject(hrConfigFactory.KEY)
    private readonly hrConfig: ConfigType<typeof hrConfigFactory>,
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly hrAssignmentService: HrAssignmentService,
    @Inject(forwardRef(() => CandidateNotificationService))
    private readonly candidateNotificationService: CandidateNotificationService,
  ) {
    super({
      loggerDefaultMeta: { service: CandidateExcelService.name },
    });
  }

  async onModuleInit(): Promise<void> {
    if (!this.config.enabled) {
      this.logger.info(
        'CandidateExcelService is disabled; skipping Excel initialization',
      );
      return;
    }

    this.ensureParentDirectory(this.config.path);
    await this.ensureWorkbookExists(this.config.path);

    this.logger.info('CandidateExcelService initialized', {
      excelPath: this.config.path,
      intervalMinutes: this.config.intervalMinutes,
      enabled: this.config.enabled,
    });
  }

  /**
   * Ensures parent directory of the configured Excel path exists safely.
   */
  public ensureParentDirectory(filePath: string): void {
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        this.logger.info(`Created parent directory for Excel file: ${dir}`);
      }
    } catch (err: any) {
      this.logger.warn(
        `Could not create directory for Excel path "${filePath}": ${err.message}`,
      );
    }
  }

  /**
   * Ensures an Excel workbook exists at the designated path with proper columns and headers.
   * If the file does not exist, it creates a well-formed workbook with the standard Candidates sheet.
   */
  public async ensureWorkbookExists(filePath: string): Promise<void> {
    if (fs.existsSync(filePath)) {
      return;
    }

    this.ensureParentDirectory(filePath);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'AI Recruitment Automation';
    workbook.lastModifiedBy = 'Recruitment Team';
    workbook.created = new Date();
    workbook.modified = new Date();

    const sheet = workbook.addWorksheet('Candidates', {
      views: [{ state: 'frozen', xSplit: 1, ySplit: 1 }],
    });

    sheet.columns = [
      { header: 'candidateId', key: 'candidateId', width: 14 },
      { header: 'name', key: 'name', width: 22 },
      { header: 'email', key: 'email', width: 30 },
      { header: 'phone', key: 'phone', width: 18 },
      { header: 'jobRole', key: 'jobRole', width: 24 },
      { header: 'screeningStatus', key: 'screeningStatus', width: 18 },
      { header: 'rejectionReason', key: 'rejectionReason', width: 32 },
      { header: 'assignedHrEmail', key: 'assignedHrEmail', width: 34 },
      { header: 'matchScore (Ref)', key: 'matchScore', width: 16 },
      { header: 'aiSummary (Ref)', key: 'aiSummary', width: 40 },
      { header: 'originalResume (Ref)', key: 'originalResume', width: 24 },
      { header: 'gmailMessageId (Ref)', key: 'gmailMessageId', width: 22 },
      {
        header: 'notificationStatus (Ref)',
        key: 'notificationStatus',
        width: 22,
      },
      { header: 'hrRemarks', key: 'hrRemarks', width: 36 },
      {
        header: 'currentInterviewRound',
        key: 'currentInterviewRound',
        width: 22,
      },
      { header: 'totalCallAttempts', key: 'totalCallAttempts', width: 16 },
      { header: '1st Call Date', key: 'call1Date', width: 18 },
      { header: '1st Call Status', key: 'call1Status', width: 18 },
      { header: '1st Call Remarks', key: 'call1Remarks', width: 28 },
      { header: '2nd Call Date', key: 'call2Date', width: 18 },
      { header: '2nd Call Status', key: 'call2Status', width: 18 },
      { header: '2nd Call Remarks', key: 'call2Remarks', width: 28 },
      { header: '3rd Call Date', key: 'call3Date', width: 18 },
      { header: '3rd Call Status', key: 'call3Status', width: 18 },
      { header: '3rd Call Remarks', key: 'call3Remarks', width: 28 },
      { header: 'nextFollowUpDate', key: 'nextFollowUpDate', width: 18 },
      {
        header: 'automatedFollowUpEmailStatus',
        key: 'automatedFollowUpEmailStatus',
        width: 28,
      },
      { header: 'followUpEmailSentAt', key: 'followUpEmailSentAt', width: 22 },
    ];

    const headerRow = sheet.getRow(1);
    headerRow.height = 28;
    headerRow.eachCell((cell, colNumber) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: colNumber <= 8 ? 'FF1F4E79' : 'FF595959' },
      };
    });

    await this.atomicSaveWorkbook(workbook, filePath);
    this.logger.info(`Initialized candidate Excel workbook at: ${filePath}`);
  }

  /**
   * Atomically writes an Excel workbook to disk using a temporary file and atomic rename.
   * Prevents corrupted workbooks if a process crashes or is interrupted during write.
   */
  private async atomicSaveWorkbook(
    workbook: ExcelJS.Workbook,
    targetPath: string,
  ): Promise<void> {
    const dir = path.dirname(targetPath);
    const tempPath = path.join(
      dir,
      `.${path.basename(targetPath)}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`,
    );

    try {
      await workbook.xlsx.writeFile(tempPath);
      await fs.promises.rename(tempPath, targetPath);
    } catch (err: any) {
      if (fs.existsSync(tempPath)) {
        try {
          await fs.promises.unlink(tempPath);
        } catch {}
      }
      throw new Error(
        `Failed to save Excel workbook atomically to "${targetPath}": ${err.message}`,
      );
    }
  }

  /**
   * Sanitizes error messages to prevent credential leakage.
   */
  private sanitizeError(err: any): { message: string } {
    const raw = String(err?.message || err || 'Unknown Excel error');
    const sanitized = raw
      .replace(/key=[a-zA-Z0-9_\-]+/gi, 'key=***')
      .replace(/token=[a-zA-Z0-9_\-]+/gi, 'token=***')
      .replace(/password=[^\s&]+/gi, 'password=***')
      .slice(0, 500);
    return { message: sanitized };
  }

  private normalizeKey(str: string): string {
    return str.toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  private getCellValueAsString(cell: ExcelJS.Cell): string | null {
    const val = cell.value;
    if (val === null || val === undefined) return null;
    if (typeof val === 'object') {
      if ('text' in val && typeof (val as any).text === 'string') {
        return (val as any).text.trim() || null;
      }
      if ('result' in val && (val as any).result !== undefined) {
        return String((val as any).result).trim() || null;
      }
      if ('richText' in val && Array.isArray((val as any).richText)) {
        return (
          (val as any).richText
            .map((rt: any) => rt.text || '')
            .join('')
            .trim() || null
        );
      }
    }
    const str = String(val).trim();
    return str.length > 0 ? str : null;
  }

  private getCellValueAsNumber(cell: ExcelJS.Cell): number | null {
    const val = cell.value;
    if (val === null || val === undefined) return null;
    if (typeof val === 'number') return isNaN(val) ? null : val;
    const str = this.getCellValueAsString(cell);
    if (!str) return null;
    const num = Number(str);
    return isNaN(num) ? null : num;
  }

  private isValidEmail(email: string | null | undefined): boolean {
    if (!email) return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  }

  /**
   * Helper to format timestamps into clean, human-readable date and time (YYYY-MM-DD HH:mm:ss in IST).
   */
  public formatHumanReadableDate(
    dateInput?: Date | string | number | null,
  ): string {
    if (!dateInput) return '';
    const trimmed =
      typeof dateInput === 'string' ? dateInput.trim() : dateInput;
    if (!trimmed) return '';

    if (
      typeof trimmed === 'string' &&
      /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(:\d{2})?$/.test(trimmed)
    ) {
      return trimmed;
    }

    const d =
      typeof trimmed === 'string' || typeof trimmed === 'number'
        ? new Date(trimmed)
        : trimmed;
    if (!(d instanceof Date) || isNaN(d.getTime())) {
      return String(trimmed);
    }

    try {
      const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
      return formatter.format(d).replace(',', '').trim();
    } catch {
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const hh = String(d.getHours()).padStart(2, '0');
      const min = String(d.getMinutes()).padStart(2, '0');
      const ss = String(d.getSeconds()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
    }
  }

  /**
   * Normalizes workflow status to standardized screening status.
   */
  public parseWorkflowStatus(status: string | null | undefined): string | null {
    if (!status) return null;
    const clean = status
      .trim()
      .toUpperCase()
      .replace(/[\s_-]+/g, '');
    if (clean === 'SHORTLIST' || clean === 'SHORTLISTED') return 'SHORTLIST';
    if (clean === 'REJECT' || clean === 'REJECTED') return 'REJECT';
    if (clean === 'MANUALREVIEW') return 'MANUAL_REVIEW';
    if (clean === 'ONHOLD') return 'ON_HOLD';
    if (clean === 'SELECTED') return 'SELECTED';
    if (clean === 'NEW') return 'NEW';
    return null;
  }

  private extractHeaderMap(worksheet: ExcelJS.Worksheet): Map<string, number> {
    const headerRow = worksheet.getRow(1);
    const headerMap = new Map<string, number>();

    headerRow.eachCell((cell, colNumber) => {
      const text = this.getCellValueAsString(cell);
      if (text) {
        headerMap.set(this.normalizeKey(text), colNumber);
      }
    });

    return headerMap;
  }

  /**
   * Resolves canonical column indices from header map with fallback variants.
   */
  private getColumnIndices(headerMap: Map<string, number>) {
    const getCol = (...keys: string[]): number | undefined => {
      for (const k of keys) {
        const val = headerMap.get(k);
        if (val !== undefined) return val;
      }
      return undefined;
    };

    const idCol = getCol('candidateid', 'id', 'candidate') ?? 1;
    const nameCol = getCol('name', 'candidatename', 'fullname') ?? 2;
    const emailCol = getCol('email', 'emailaddress') ?? 3;
    const phoneCol =
      getCol('phone', 'phonenumber', 'mobilenumber', 'mobile') ?? 4;
    const roleCol =
      getCol('jobrole', 'appliedjobrole', 'appliedrole', 'jobroleappliedfor') ??
      5;
    const statusCol =
      getCol('screeningstatus', 'applicationstatus', 'status') ?? 6;
    const rejectionReasonCol =
      getCol('rejectionreason', 'hrremarks', 'remarks') ?? 7;
    const hrEmailCol = getCol('assignedhremail', 'assignedhr', 'hremail') ?? 8;
    const hrNameCol = getCol('assignedhrname', 'hrname');
    const scoreCol = getCol('matchscore', 'matchscoreref') ?? 9;
    const summaryCol = getCol('aisummary', 'aisummaryref', 'summary') ?? 10;
    const resumeCol =
      getCol('originalresume', 'originalresumeref', 'resume') ?? 11;
    const msgCol =
      getCol('gmailmessageid', 'gmailmessageidref', 'messageid') ?? 12;
    const notifCol =
      getCol('notificationstatus', 'notificationstatusref') ?? 13;
    const hrRemarksCol = getCol('hrremarks') ?? rejectionReasonCol ?? 14;
    const roundCol = getCol('currentinterviewround', 'interviewround') ?? 15;
    const callCountCol =
      getCol('totalcallattempts', 'callcount', 'callattempts') ?? 16;
    const call1DateCol = getCol('1stcalldate', 'call1date');
    const call1StatusCol = getCol('1stcallstatus', 'call1status');
    const call1RemarksCol = getCol('1stcallremarks', 'call1remarks');
    const call2DateCol = getCol('2ndcalldate', 'call2date');
    const call2StatusCol = getCol('2ndcallstatus', 'call2status');
    const call2RemarksCol = getCol('2ndcallremarks', 'call2remarks');
    const call3DateCol = getCol('3rdcalldate', 'call3date');
    const call3StatusCol = getCol('3rdcallstatus', 'call3status');
    const call3RemarksCol = getCol('3rdcallremarks', 'call3remarks');

    const call1Col = getCol('call1dateandstatus', 'call1') ?? call1DateCol;
    const call2Col = getCol('call2dateandstatus', 'call2') ?? call2DateCol;
    const call3Col = getCol('call3dateandstatus', 'call3') ?? call3DateCol;
    const callStatusCol =
      getCol('lastcallstatus', 'callstatus') ?? call1StatusCol;
    const contactDateCol = getCol('lastcontactdate') ?? call1DateCol;
    const lastCallDateCol = getCol('lastcalldate') ?? contactDateCol;
    const followUpDateCol = getCol('nextfollowupdate') ?? 26;
    const emailStatusCol =
      getCol(
        'automatedfollowupemailstatus',
        'followupemailstatus',
        'emailstatus',
      ) ?? 27;
    const emailSentAtCol = getCol('followupemailsentat', 'emailsentat') ?? 28;
    const expCol = getCol(
      'experience',
      'totalexperienceyears',
      'totalexperience',
    );
    const companyCol = getCol('currentcompany', 'company');

    return {
      idCol,
      nameCol,
      emailCol,
      phoneCol,
      roleCol,
      statusCol,
      rejectionReasonCol,
      hrEmailCol,
      hrNameCol,
      scoreCol,
      summaryCol,
      resumeCol,
      msgCol,
      notifCol,
      hrRemarksCol,
      roundCol,
      callCountCol,
      callStatusCol,
      contactDateCol,
      followUpDateCol,
      call1Col,
      call2Col,
      call3Col,
      call1DateCol,
      call1StatusCol,
      call1RemarksCol,
      call2DateCol,
      call2StatusCol,
      call2RemarksCol,
      call3DateCol,
      call3StatusCol,
      call3RemarksCol,
      lastCallDateCol,
      emailStatusCol,
      emailSentAtCol,
      expCol,
      companyCol,
    };
  }

  /**
   * Helper to load workbook and worksheet from path safely.
   */
  private async loadWorksheet(filePath = this.config.path): Promise<{
    workbook: ExcelJS.Workbook;
    worksheet: ExcelJS.Worksheet;
  } | null> {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const worksheet =
      workbook.getWorksheet('Candidates') || workbook.worksheets[0];
    if (!worksheet) {
      return null;
    }
    return { workbook, worksheet };
  }

  /**
   * Reads all candidate records from worksheet rows.
   */
  private getAllCandidateRecords(
    worksheet: ExcelJS.Worksheet,
  ): ExcelCandidateRecord[] {
    const headerMap = this.extractHeaderMap(worksheet);
    const records: ExcelCandidateRecord[] = [];
    for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber++) {
      const record = this.mapRowToCandidate(
        worksheet.getRow(rowNumber),
        headerMap,
      );
      if (record) {
        records.push(record);
      }
    }
    return records;
  }

  private mapRowToCandidate(
    row: ExcelJS.Row,
    headerMap: Map<string, number>,
  ): ExcelCandidateRecord | null {
    const cols = this.getColumnIndices(headerMap);

    const id = this.getCellValueAsNumber(row.getCell(cols.idCol));
    const email = this.getCellValueAsString(row.getCell(cols.emailCol));
    const name = this.getCellValueAsString(row.getCell(cols.nameCol));

    if (!id && !email) {
      return null;
    }

    let assignedHrEmail =
      this.getCellValueAsString(row.getCell(cols.hrEmailCol)) || undefined;
    let assignedHrName = cols.hrNameCol
      ? this.getCellValueAsString(row.getCell(cols.hrNameCol)) || ''
      : '';

    // Handle case where HR name was stored in hrEmailCol
    if (
      assignedHrEmail &&
      !this.isValidEmail(assignedHrEmail) &&
      !assignedHrName
    ) {
      assignedHrName = assignedHrEmail;
      assignedHrEmail = undefined;
    }

    // Infer name from email if name is missing
    if (
      !assignedHrName &&
      assignedHrEmail &&
      this.isValidEmail(assignedHrEmail)
    ) {
      const lowerEmail = assignedHrEmail.toLowerCase();
      if (
        this.hrConfig.hr2?.email &&
        lowerEmail === this.hrConfig.hr2.email.toLowerCase()
      ) {
        assignedHrName = this.hrConfig.hr2.name || 'Jayendra';
      } else if (
        this.hrConfig.hr1?.email &&
        lowerEmail === this.hrConfig.hr1.email.toLowerCase()
      ) {
        assignedHrName = this.hrConfig.hr1.name || 'Abhishek';
      } else if (
        this.hrConfig.manualReviewEmail &&
        lowerEmail === this.hrConfig.manualReviewEmail.toLowerCase()
      ) {
        assignedHrName = 'Manual Review';
      } else {
        assignedHrName = assignedHrEmail.split('@')[0];
      }
    }

    // Infer email from name if email is missing or not a valid email
    if (
      (!assignedHrEmail || !this.isValidEmail(assignedHrEmail)) &&
      assignedHrName
    ) {
      const lowerName = assignedHrName.toLowerCase();
      if (
        lowerName === (this.hrConfig.hr2?.name || 'Jayendra').toLowerCase() ||
        lowerName === (this.hrConfig.hr2?.id || 'hr-2').toLowerCase() ||
        lowerName === 'jayendra'
      ) {
        assignedHrEmail = this.hrConfig.hr2?.email || undefined;
        assignedHrName = this.hrConfig.hr2?.name || 'Jayendra';
      } else if (
        lowerName === (this.hrConfig.hr1?.name || 'Abhishek').toLowerCase() ||
        lowerName === (this.hrConfig.hr1?.id || 'hr-1').toLowerCase() ||
        lowerName === 'abhishek'
      ) {
        assignedHrEmail = this.hrConfig.hr1?.email || undefined;
        assignedHrName = this.hrConfig.hr1?.name || 'Abhishek';
      } else if (lowerName === 'manual review') {
        assignedHrEmail = this.hrConfig.manualReviewEmail || undefined;
        assignedHrName = 'Manual Review';
      }
    }

    if (!assignedHrName) {
      assignedHrName = 'Unassigned';
    }

    const rawStatus =
      this.getCellValueAsString(row.getCell(cols.statusCol)) || 'NEW';
    const parsedStatus = this.parseWorkflowStatus(rawStatus) || 'NEW';

    return {
      id: id || row.number - 1,
      name: name || 'Candidate',
      email: email || '',
      phone: this.getCellValueAsString(row.getCell(cols.phoneCol)) || '',
      jobRole:
        this.getCellValueAsString(row.getCell(cols.roleCol)) || 'Applicant',
      assignedHrName,
      assignedHrEmail,
      screeningStatus: parsedStatus,
      applicationStatus: rawStatus || 'New',
      rejectionReason: this.getCellValueAsString(
        row.getCell(cols.hrRemarksCol),
      ),
      hrRemarks: this.getCellValueAsString(row.getCell(cols.hrRemarksCol)),
      matchScore: this.getCellValueAsNumber(row.getCell(cols.scoreCol)),
      summary: this.getCellValueAsString(row.getCell(cols.summaryCol)) || '',
      originalResume:
        this.getCellValueAsString(row.getCell(cols.resumeCol)) || undefined,
      gmailMessageId:
        this.getCellValueAsString(row.getCell(cols.msgCol)) || undefined,
      notificationStatus:
        this.getCellValueAsString(row.getCell(cols.notifCol)) || 'PENDING',
      currentInterviewRound:
        this.getCellValueAsString(row.getCell(cols.roundCol)) || 'Not Started',
      callCount: this.getCellValueAsNumber(row.getCell(cols.callCountCol)) || 0,
      totalCallAttempts:
        this.getCellValueAsNumber(row.getCell(cols.callCountCol)) || 0,
      call1Date: cols.call1DateCol
        ? this.getCellValueAsString(row.getCell(cols.call1DateCol)) || undefined
        : undefined,
      call1Status: cols.call1StatusCol
        ? this.getCellValueAsString(row.getCell(cols.call1StatusCol)) ||
          undefined
        : undefined,
      call1Remarks: cols.call1RemarksCol
        ? this.getCellValueAsString(row.getCell(cols.call1RemarksCol)) ||
          undefined
        : undefined,
      call2Date: cols.call2DateCol
        ? this.getCellValueAsString(row.getCell(cols.call2DateCol)) || undefined
        : undefined,
      call2Status: cols.call2StatusCol
        ? this.getCellValueAsString(row.getCell(cols.call2StatusCol)) ||
          undefined
        : undefined,
      call2Remarks: cols.call2RemarksCol
        ? this.getCellValueAsString(row.getCell(cols.call2RemarksCol)) ||
          undefined
        : undefined,
      call3Date: cols.call3DateCol
        ? this.getCellValueAsString(row.getCell(cols.call3DateCol)) || undefined
        : undefined,
      call3Status: cols.call3StatusCol
        ? this.getCellValueAsString(row.getCell(cols.call3StatusCol)) ||
          undefined
        : undefined,
      call3Remarks: cols.call3RemarksCol
        ? this.getCellValueAsString(row.getCell(cols.call3RemarksCol)) ||
          undefined
        : undefined,
      lastCallStatus:
        (cols.callStatusCol
          ? this.getCellValueAsString(row.getCell(cols.callStatusCol))
          : undefined) || 'Not Called',
      lastContactDate: cols.contactDateCol
        ? this.getCellValueAsString(row.getCell(cols.contactDateCol)) ||
          undefined
        : undefined,
      nextFollowUpDate:
        this.getCellValueAsString(row.getCell(cols.followUpDateCol)) ||
        undefined,
      call1DateAndStatus: cols.call1Col
        ? this.getCellValueAsString(row.getCell(cols.call1Col)) || undefined
        : undefined,
      call2DateAndStatus: cols.call2Col
        ? this.getCellValueAsString(row.getCell(cols.call2Col)) || undefined
        : undefined,
      call3DateAndStatus: cols.call3Col
        ? this.getCellValueAsString(row.getCell(cols.call3Col)) || undefined
        : undefined,
      lastCallDate: cols.lastCallDateCol
        ? this.getCellValueAsString(row.getCell(cols.lastCallDateCol)) ||
          undefined
        : undefined,
      automatedFollowUpEmailStatus: cols.emailStatusCol
        ? this.getCellValueAsString(row.getCell(cols.emailStatusCol)) ||
          undefined
        : undefined,
      followUpEmailSentAt: cols.emailSentAtCol
        ? this.getCellValueAsString(row.getCell(cols.emailSentAtCol)) ||
          undefined
        : undefined,
      experience: cols.expCol
        ? this.getCellValueAsString(row.getCell(cols.expCol)) || ''
        : '',
      currentCompany: cols.companyCol
        ? this.getCellValueAsString(row.getCell(cols.companyCol)) || undefined
        : undefined,
      company: cols.companyCol
        ? this.getCellValueAsString(row.getCell(cols.companyCol)) || undefined
        : undefined,
    };
  }

  /**
   * Executes a write task inside an exclusive distributed lock (Redis) and in-process mutex queue.
   */
  private async executeWithLock<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.fileWriteQueue = this.fileWriteQueue
        .then(async () => {
          let redisLockAcquired = false;
          const lockToken = crypto.randomUUID();

          if (this.redisService?.client) {
            try {
              const res = await this.redisService.client.set(
                CandidateExcelService.REDIS_LOCK_KEY,
                lockToken,
                'EX',
                CandidateExcelService.REDIS_LOCK_TTL_SECONDS,
                'NX',
              );
              redisLockAcquired = res === 'OK';
            } catch (err: any) {
              this.logger.warn(
                `Redis lock unavailable (${err.message}); proceeding with local mutex lock`,
              );
            }
          }

          try {
            const result = await task();
            resolve(result);
          } catch (err) {
            reject(err);
          } finally {
            if (redisLockAcquired && this.redisService?.client) {
              try {
                const luaRelease = `
                  if redis.call("get", KEYS[1]) == ARGV[1] then
                    return redis.call("del", KEYS[1])
                  else
                    return 0
                  end
                `;
                await this.redisService.client.eval(
                  luaRelease,
                  1,
                  CandidateExcelService.REDIS_LOCK_KEY,
                  lockToken,
                );
              } catch {}
            }
          }
        })
        .catch(reject);
    });
  }

  /**
   * Saves or updates a candidate record directly in the local Excel workbook.
   * Prevents duplicates by matching existing candidate ID or normalized email.
   * PRESERVES existing HR-entered remarks, interview rounds, call attempts, and follow-ups.
   */
  public async saveCandidate(
    input: SaveCandidateInput,
  ): Promise<ExcelCandidateRecord> {
    return this.executeWithLock(async () => {
      const filePath = this.config.path;
      await this.ensureWorkbookExists(filePath);

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(filePath);

      const worksheet =
        workbook.getWorksheet('Candidates') || workbook.worksheets[0];
      if (!worksheet) {
        throw new Error(
          `Corrupted Excel file: no worksheet found in ${filePath}`,
        );
      }

      const headerMap = this.extractHeaderMap(worksheet);
      const cols = this.getColumnIndices(headerMap);

      let targetRow: ExcelJS.Row | null = null;
      let matchedCandidateId: number | null = null;
      let maxExistingId = -1;
      let hasExistingId = false;

      const normalizedInputEmail = input.email
        ? input.email.trim().toLowerCase()
        : null;

      // Scan rows to find existing candidate or max ID
      for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber++) {
        const row = worksheet.getRow(rowNumber);
        const cellId = this.getCellValueAsNumber(row.getCell(cols.idCol));
        const cellEmail = this.getCellValueAsString(row.getCell(cols.emailCol));
        const cellMsgId = this.getCellValueAsString(row.getCell(cols.msgCol));

        if (cellId !== null && cellId !== undefined && !isNaN(cellId)) {
          hasExistingId = true;
          if (cellId > maxExistingId) {
            maxExistingId = cellId;
          }
        }

        // Match by ID if provided
        if (
          input.id !== undefined &&
          input.id !== null &&
          cellId === input.id
        ) {
          targetRow = row;
          matchedCandidateId = cellId;
          break;
        }

        // Match by Email (duplicate prevention)
        if (
          normalizedInputEmail &&
          cellEmail &&
          cellEmail.trim().toLowerCase() === normalizedInputEmail
        ) {
          targetRow = row;
          matchedCandidateId =
            cellId !== null && cellId !== undefined
              ? cellId
              : hasExistingId
                ? maxExistingId + 1
                : 0;
          break;
        }

        // Match by Gmail Message ID if available
        if (
          input.gmailMessageId &&
          cellMsgId &&
          cellMsgId.trim() === input.gmailMessageId.trim()
        ) {
          targetRow = row;
          matchedCandidateId =
            cellId !== null && cellId !== undefined
              ? cellId
              : hasExistingId
                ? maxExistingId + 1
                : 0;
          break;
        }
      }

      const isNew = !targetRow;
      const fallbackId = hasExistingId ? maxExistingId + 1 : 0;
      const candidateId =
        matchedCandidateId !== null && matchedCandidateId !== undefined
          ? matchedCandidateId
          : input.id !== undefined && input.id !== null
            ? input.id
            : fallbackId;

      if (isNew) {
        targetRow = worksheet.addRow([]);
        targetRow.getCell(cols.idCol).value = candidateId;
      }

      // Preserve existing HR-entered remarks/fields during updates
      const existingHrRemarks = isNew
        ? null
        : this.getCellValueAsString(targetRow!.getCell(cols.hrRemarksCol));
      const existingRound = isNew
        ? null
        : this.getCellValueAsString(targetRow!.getCell(cols.roundCol));
      const existingCallCount = isNew
        ? null
        : this.getCellValueAsNumber(targetRow!.getCell(cols.callCountCol));
      const existingCallStatus =
        isNew || !cols.callStatusCol
          ? null
          : this.getCellValueAsString(targetRow!.getCell(cols.callStatusCol));
      const existingContactDate =
        isNew || !cols.contactDateCol
          ? null
          : this.getCellValueAsString(targetRow!.getCell(cols.contactDateCol));
      const existingFollowUpDate = isNew
        ? null
        : this.getCellValueAsString(targetRow!.getCell(cols.followUpDateCol));
      const existingCall1 =
        isNew || !cols.call1Col
          ? null
          : this.getCellValueAsString(targetRow!.getCell(cols.call1Col));
      const existingCall2 =
        isNew || !cols.call2Col
          ? null
          : this.getCellValueAsString(targetRow!.getCell(cols.call2Col));
      const existingCall3 =
        isNew || !cols.call3Col
          ? null
          : this.getCellValueAsString(targetRow!.getCell(cols.call3Col));
      const existingLastCallDate =
        isNew || !cols.lastCallDateCol
          ? null
          : this.getCellValueAsString(targetRow!.getCell(cols.lastCallDateCol));
      const existingEmailStatus =
        isNew || !cols.emailStatusCol
          ? null
          : this.getCellValueAsString(targetRow!.getCell(cols.emailStatusCol));
      const existingEmailSentAt =
        isNew || !cols.emailSentAtCol
          ? null
          : this.getCellValueAsString(targetRow!.getCell(cols.emailSentAtCol));

      // Core details
      if (input.name)
        targetRow!.getCell(cols.nameCol).value = input.name.trim();
      if (input.email)
        targetRow!.getCell(cols.emailCol).value = input.email.trim();
      if (input.phone) {
        let phoneVal = input.phone.trim();
        if (
          phoneVal.startsWith("'") ||
          phoneVal.startsWith('’') ||
          phoneVal.startsWith('`')
        ) {
          phoneVal = phoneVal.substring(1).trim();
        }
        targetRow!.getCell(cols.phoneCol).value = phoneVal;
      }
      if (input.jobRole)
        targetRow!.getCell(cols.roleCol).value = input.jobRole.trim();

      const normalizedStatus =
        this.parseWorkflowStatus(input.screeningStatus) ||
        input.screeningStatus ||
        'NEW';
      targetRow!.getCell(cols.statusCol).value = normalizedStatus;

      // Remarks / Rejection Reason: Clear rejection reason if shortlisted; preserve existing remarks if input is blank
      let rejectionReasonToWrite = '';
      if (normalizedStatus === 'SHORTLIST') {
        rejectionReasonToWrite = '';
      } else if (input.rejectionReason) {
        rejectionReasonToWrite = input.rejectionReason.trim();
      }
      targetRow!.getCell(cols.rejectionReasonCol).value =
        rejectionReasonToWrite;

      if (cols.hrRemarksCol && cols.hrRemarksCol !== cols.rejectionReasonCol) {
        const hrRemarksToWrite =
          input.hrRemarks?.trim() ||
          input.summary?.trim() ||
          existingHrRemarks ||
          '';
        targetRow!.getCell(cols.hrRemarksCol).value = hrRemarksToWrite;
      }

      // Assigned HR
      if (input.assignedHrEmail) {
        targetRow!.getCell(cols.hrEmailCol).value =
          input.assignedHrEmail.trim();
      }
      if (cols.hrNameCol && input.assignedHrName) {
        targetRow!.getCell(cols.hrNameCol).value = input.assignedHrName.trim();
      }

      // Reference columns
      if (input.matchScore !== undefined && input.matchScore !== null) {
        targetRow!.getCell(cols.scoreCol).value = input.matchScore;
      }
      if (input.summary) {
        targetRow!.getCell(cols.summaryCol).value = input.summary.trim();
      }
      if (input.originalResume) {
        targetRow!.getCell(cols.resumeCol).value = input.originalResume.trim();
      }
      if (input.gmailMessageId) {
        targetRow!.getCell(cols.msgCol).value = input.gmailMessageId.trim();
      }
      if (input.notificationStatus) {
        targetRow!.getCell(cols.notifCol).value =
          input.notificationStatus.trim();
      }

      // Preserve Interview & Contact info
      if (input.currentInterviewRound) {
        targetRow!.getCell(cols.roundCol).value =
          input.currentInterviewRound.trim();
      } else if (existingRound) {
        targetRow!.getCell(cols.roundCol).value = existingRound;
      }

      if (
        input.totalCallAttempts !== undefined &&
        input.totalCallAttempts !== null
      ) {
        targetRow!.getCell(cols.callCountCol).value = input.totalCallAttempts;
      } else if (input.callCount !== undefined && input.callCount !== null) {
        targetRow!.getCell(cols.callCountCol).value = input.callCount;
      } else if (existingCallCount !== null) {
        targetRow!.getCell(cols.callCountCol).value = existingCallCount;
      }

      if (cols.call1DateCol && input.call1Date) {
        targetRow!.getCell(cols.call1DateCol).value = input.call1Date.trim();
      }
      if (cols.call1StatusCol) {
        if (input.call1Status) {
          targetRow!.getCell(cols.call1StatusCol).value =
            input.call1Status.trim();
        } else if (isNew) {
          targetRow!.getCell(cols.call1StatusCol).value = '';
        }
      }
      if (cols.call1RemarksCol && input.call1Remarks) {
        targetRow!.getCell(cols.call1RemarksCol).value =
          input.call1Remarks.trim();
      }

      if (cols.call2DateCol && input.call2Date) {
        targetRow!.getCell(cols.call2DateCol).value = input.call2Date.trim();
      }
      if (cols.call2StatusCol && input.call2Status) {
        targetRow!.getCell(cols.call2StatusCol).value =
          input.call2Status.trim();
      }
      if (cols.call2RemarksCol && input.call2Remarks) {
        targetRow!.getCell(cols.call2RemarksCol).value =
          input.call2Remarks.trim();
      }

      if (cols.call3DateCol && input.call3Date) {
        targetRow!.getCell(cols.call3DateCol).value = input.call3Date.trim();
      }
      if (cols.call3StatusCol && input.call3Status) {
        targetRow!.getCell(cols.call3StatusCol).value =
          input.call3Status.trim();
      }
      if (cols.call3RemarksCol && input.call3Remarks) {
        targetRow!.getCell(cols.call3RemarksCol).value =
          input.call3Remarks.trim();
      }

      if (cols.callStatusCol) {
        if (input.lastCallStatus) {
          targetRow!.getCell(cols.callStatusCol).value =
            input.lastCallStatus.trim();
        } else if (existingCallStatus) {
          targetRow!.getCell(cols.callStatusCol).value = existingCallStatus;
        }
      }

      if (cols.contactDateCol) {
        if (input.lastContactDate) {
          targetRow!.getCell(cols.contactDateCol).value =
            input.lastContactDate.trim();
        } else if (existingContactDate) {
          targetRow!.getCell(cols.contactDateCol).value = existingContactDate;
        }
      }

      if (input.nextFollowUpDate) {
        targetRow!.getCell(cols.followUpDateCol).value =
          input.nextFollowUpDate.trim();
      } else if (existingFollowUpDate) {
        targetRow!.getCell(cols.followUpDateCol).value = existingFollowUpDate;
      }

      // HR Call tracking columns
      if (cols.call1Col) {
        if (input.call1DateAndStatus) {
          targetRow!.getCell(cols.call1Col).value =
            input.call1DateAndStatus.trim();
        } else if (existingCall1) {
          targetRow!.getCell(cols.call1Col).value = existingCall1;
        }
      }
      if (cols.call2Col) {
        if (input.call2DateAndStatus) {
          targetRow!.getCell(cols.call2Col).value =
            input.call2DateAndStatus.trim();
        } else if (existingCall2) {
          targetRow!.getCell(cols.call2Col).value = existingCall2;
        }
      }
      if (cols.call3Col) {
        if (input.call3DateAndStatus) {
          targetRow!.getCell(cols.call3Col).value =
            input.call3DateAndStatus.trim();
        } else if (existingCall3) {
          targetRow!.getCell(cols.call3Col).value = existingCall3;
        }
      }
      if (cols.lastCallDateCol) {
        if (input.lastCallDate) {
          targetRow!.getCell(cols.lastCallDateCol).value =
            input.lastCallDate.trim();
        } else if (existingLastCallDate) {
          targetRow!.getCell(cols.lastCallDateCol).value = existingLastCallDate;
        }
      }
      if (cols.emailStatusCol) {
        if (input.automatedFollowUpEmailStatus) {
          targetRow!.getCell(cols.emailStatusCol).value =
            input.automatedFollowUpEmailStatus.trim();
        } else if (existingEmailStatus) {
          targetRow!.getCell(cols.emailStatusCol).value = existingEmailStatus;
        }
      }
      if (cols.emailSentAtCol) {
        if (input.followUpEmailSentAt) {
          targetRow!.getCell(cols.emailSentAtCol).value =
            this.formatHumanReadableDate(input.followUpEmailSentAt);
        } else if (existingEmailSentAt) {
          targetRow!.getCell(cols.emailSentAtCol).value =
            this.formatHumanReadableDate(existingEmailSentAt);
        }
      }

      targetRow!.commit();

      // Write atomically to file
      await this.atomicSaveWorkbook(workbook, filePath);

      this.logger.info(
        `${isNew ? 'Added new' : 'Updated'} candidate ID ${candidateId} in local Excel (${input.name || 'Candidate'}, Status: ${normalizedStatus})`,
      );

      return this.mapRowToCandidate(
        targetRow!,
        headerMap,
      ) as ExcelCandidateRecord;
    });
  }

  /**
   * Retrieves a candidate profile by ID directly from the Excel workbook.
   */
  public async getCandidateById(
    id: number,
  ): Promise<ExcelCandidateRecord | null> {
    const loaded = await this.loadWorksheet();
    if (!loaded) return null;

    const { worksheet } = loaded;
    const headerMap = this.extractHeaderMap(worksheet);
    const idCol = this.getColumnIndices(headerMap).idCol;

    for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber++) {
      const row = worksheet.getRow(rowNumber);
      if (this.getCellValueAsNumber(row.getCell(idCol)) === id) {
        return this.mapRowToCandidate(row, headerMap);
      }
    }

    return null;
  }

  /**
   * Retrieves a candidate profile by normalized email directly from the Excel workbook.
   */
  public async getCandidateByEmail(
    email: string,
  ): Promise<ExcelCandidateRecord | null> {
    if (!email) return null;
    const targetEmail = email.trim().toLowerCase();

    const loaded = await this.loadWorksheet();
    if (!loaded) return null;

    const { worksheet } = loaded;
    const headerMap = this.extractHeaderMap(worksheet);
    const emailCol = this.getColumnIndices(headerMap).emailCol;

    for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber++) {
      const row = worksheet.getRow(rowNumber);
      const rowEmail = this.getCellValueAsString(row.getCell(emailCol));
      if (rowEmail && rowEmail.trim().toLowerCase() === targetEmail) {
        return this.mapRowToCandidate(row, headerMap);
      }
    }

    return null;
  }

  /**
   * Retrieves all candidate records stored in the authoritative Excel file.
   */
  public async getAllCandidates(): Promise<ExcelCandidateRecord[]> {
    const loaded = await this.loadWorksheet();
    if (!loaded || loaded.worksheet.rowCount < 2) {
      return [];
    }
    return this.getAllCandidateRecords(loaded.worksheet);
  }

  /**
   * Lists all candidates with search, filtering, and pagination from the local Excel file.
   */
  public async findCandidates(query: CandidateQueryDto): Promise<{
    candidates: ExcelCandidateRecord[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const anyQuery = query as any;
    const limit = Math.max(
      1,
      Math.min(100, Number(anyQuery.limit || anyQuery.take) || 20),
    );
    const skip = Number(anyQuery.skip) || 0;
    const page = anyQuery.page
      ? Math.max(1, Number(anyQuery.page))
      : Math.floor(skip / limit) + 1;

    const loaded = await this.loadWorksheet();
    if (!loaded || loaded.worksheet.rowCount < 2) {
      return {
        candidates: [],
        total: 0,
        page,
        limit,
        totalPages: 0,
      };
    }

    let filtered = this.getAllCandidateRecords(loaded.worksheet);

    if (query.search?.trim()) {
      const term = query.search.trim().toLowerCase();
      filtered = filtered.filter(
        (c) =>
          c.name.toLowerCase().includes(term) ||
          c.email.toLowerCase().includes(term) ||
          c.phone.toLowerCase().includes(term) ||
          c.jobRole.toLowerCase().includes(term),
      );
    }

    if (query.status) {
      const targetStatus = String(query.status).trim().toUpperCase();
      filtered = filtered.filter((c) => {
        const s = (
          c.screeningStatus ||
          c.applicationStatus ||
          ''
        ).toUpperCase();
        return s.includes(targetStatus);
      });
    }

    const targetRole = (query.role || (query as any).jobRole)
      ?.trim()
      ?.toLowerCase();
    if (targetRole) {
      filtered = filtered.filter((c) =>
        c.jobRole.toLowerCase().includes(targetRole),
      );
    }

    if (query.assignedHr?.trim()) {
      const targetHr = query.assignedHr.trim().toLowerCase();
      filtered = filtered.filter(
        (c) =>
          (c.assignedHrEmail || '').toLowerCase().includes(targetHr) ||
          (c.assignedHrName || '').toLowerCase().includes(targetHr),
      );
    }

    const total = filtered.length;
    const totalPages = Math.ceil(total / limit);
    const offset = (page - 1) * limit;
    const paginated = filtered.slice(offset, offset + limit);

    return {
      candidates: paginated,
      total,
      page,
      limit,
      totalPages,
    };
  }

  /**
   * Aggregates recruitment pipeline metrics from the local Excel file.
   */
  public async getDashboardStats(): Promise<CandidateStatsResponse> {
    const emptyStats: CandidateStatsResponse = {
      total: 0,
      totalCandidates: 0,
      shortlisted: 0,
      rejected: 0,
      manualReview: 0,
      pending: 0,
      assignedToHr1: 0,
      assignedToHr2: 0,
      unassigned: 0,
      roleBreakdown: [],
    };

    const loaded = await this.loadWorksheet();
    if (!loaded || loaded.worksheet.rowCount < 2) {
      return emptyStats;
    }

    const records = this.getAllCandidateRecords(loaded.worksheet);
    let shortlisted = 0;
    let rejected = 0;
    let manualReview = 0;
    let pending = 0;
    let assignedToHr1 = 0;
    let assignedToHr2 = 0;
    let unassigned = 0;

    const hr1Email = this.hrConfig.hr1?.email?.toLowerCase();
    const hr2Email = this.hrConfig.hr2?.email?.toLowerCase();
    const roleCounts = new Map<string, number>();

    for (const record of records) {
      const statusUpper = (record.screeningStatus || '').toUpperCase();

      if (statusUpper.includes('SHORTLIST')) {
        shortlisted++;
      } else if (statusUpper.includes('REJECT')) {
        rejected++;
      } else if (
        statusUpper.includes('MANUAL') ||
        statusUpper.includes('HOLD')
      ) {
        manualReview++;
      } else {
        pending++;
      }

      const assignedEmail = (record.assignedHrEmail || '').toLowerCase();
      if (hr1Email && assignedEmail === hr1Email) {
        assignedToHr1++;
      } else if (hr2Email && assignedEmail === hr2Email) {
        assignedToHr2++;
      } else {
        unassigned++;
      }

      const role = record.jobRole || 'Unspecified';
      roleCounts.set(role, (roleCounts.get(role) || 0) + 1);
    }

    const total = records.length;
    const roleBreakdown = Array.from(roleCounts.entries()).map(
      ([role, count]) => ({
        role,
        count,
      }),
    );

    return {
      total,
      totalCandidates: total,
      shortlisted,
      rejected,
      manualReview,
      pending,
      assignedToHr1,
      assignedToHr2,
      unassigned,
      roleBreakdown,
    };
  }

  /**
   * Scheduled job checking interval elapsed to run validation/sync.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async handleScheduledSync(): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    const intervalMs = this.config.intervalMinutes * 60 * 1000;
    const now = Date.now();

    if (now - this.lastScheduledRunAt < intervalMs) {
      return;
    }

    this.lastScheduledRunAt = now;
    await this.syncFromExcel({ triggerSource: ExcelSyncTrigger.Scheduled });
  }

  /**
   * Helper to construct an ExcelSyncResult with default values.
   */
  private createSyncResult(
    partial: Partial<ExcelSyncResult> & { status: ExcelSyncStatus },
    startedAt: Date,
    startTime: number,
    triggerSource: ExcelSyncTrigger,
  ): ExcelSyncResult {
    return {
      totalRows: 0,
      processedRows: 0,
      updatedRows: 0,
      skippedRows: 0,
      errorCount: 0,
      errors: [],
      startedAt,
      completedAt: new Date(),
      durationMs: Date.now() - startTime,
      triggerSource,
      ...partial,
    };
  }

  /**
   * Validates local candidate Excel workbook, normalizes statuses, and dispatches notifications
   * for candidates newly shortlisted by HR.
   */
  public async syncFromExcel(options?: {
    triggerSource?: ExcelSyncTrigger;
    force?: boolean;
  }): Promise<ExcelSyncResult> {
    const triggerSource = options?.triggerSource || ExcelSyncTrigger.Scheduled;
    const force = Boolean(options?.force);
    const startedAt = new Date();
    const startTime = Date.now();

    if (!this.config.enabled && !force) {
      this.logger.info('Excel sync skipped: feature is disabled');
      return this.createSyncResult(
        {
          status: ExcelSyncStatus.Skipped,
          message: 'CandidateExcelService is disabled',
        },
        startedAt,
        startTime,
        triggerSource,
      );
    }

    if (this.isSyncInProgress) {
      this.logger.warn('Excel sync already running in this process; skipping');
      return this.createSyncResult(
        {
          status: ExcelSyncStatus.Skipped,
          message: 'Sync already in progress',
        },
        startedAt,
        startTime,
        triggerSource,
      );
    }

    this.isSyncInProgress = true;

    try {
      if (!fs.existsSync(this.config.path)) {
        this.logger.warn(`Excel file not found at "${this.config.path}"`);
        return this.createSyncResult(
          {
            status: ExcelSyncStatus.Skipped,
            message: `Excel file does not exist at ${this.config.path}`,
          },
          startedAt,
          startTime,
          triggerSource,
        );
      }

      let fileBuffer: Buffer;
      try {
        fileBuffer = await fs.promises.readFile(this.config.path);
      } catch (readErr: any) {
        const errorResult = this.createSyncResult(
          {
            status: ExcelSyncStatus.Failed,
            errorCount: 1,
            errors: [
              { row: 0, error: `File cannot be read: ${readErr.message}` },
            ],
            message: `File read error: ${readErr.message}`,
          },
          startedAt,
          startTime,
          triggerSource,
        );
        await this.saveSyncLog(errorResult);
        return errorResult;
      }

      const fileHash = crypto
        .createHash('sha256')
        .update(fileBuffer)
        .digest('hex');

      if (!force) {
        try {
          const previousSync = await this.prisma.excelSyncLog.findFirst({
            where: {
              fileHash,
              status: {
                in: [ExcelSyncStatus.Success, ExcelSyncStatus.Partial],
              },
            },
            orderBy: { completedAt: 'desc' },
          });

          if (previousSync) {
            return this.createSyncResult(
              {
                status: ExcelSyncStatus.Skipped,
                fileHash,
                message: 'File content unchanged since last successful sync',
              },
              startedAt,
              startTime,
              triggerSource,
            );
          }
        } catch {}
      }

      const workbook = new ExcelJS.Workbook();
      try {
        await workbook.xlsx.load(fileBuffer as any);
      } catch (parseErr: any) {
        const parseErrorResult = this.createSyncResult(
          {
            status: ExcelSyncStatus.Failed,
            fileHash,
            errorCount: 1,
            errors: [
              { row: 0, error: `Corrupted Excel file: ${parseErr.message}` },
            ],
            message: parseErr.message,
          },
          startedAt,
          startTime,
          triggerSource,
        );
        await this.saveSyncLog(parseErrorResult);
        return parseErrorResult;
      }

      const worksheet =
        workbook.getWorksheet('Candidates') || workbook.worksheets[0];
      if (!worksheet || worksheet.rowCount < 2) {
        return this.createSyncResult(
          {
            status: ExcelSyncStatus.Skipped,
            fileHash,
            message: 'Worksheet contains no candidate rows',
          },
          startedAt,
          startTime,
          triggerSource,
        );
      }

      const headerMap = this.extractHeaderMap(worksheet);

      if (
        !headerMap.has('candidateid') &&
        !headerMap.has('id') &&
        !headerMap.has('email') &&
        !headerMap.has('emailaddress')
      ) {
        const headerError = this.createSyncResult(
          {
            status: ExcelSyncStatus.Failed,
            fileHash,
            errorCount: 1,
            errors: [
              {
                row: 1,
                error:
                  'Missing required identifier header ("candidateId" or "email")',
              },
            ],
            message: 'Missing candidate identifier header columns',
          },
          startedAt,
          startTime,
          triggerSource,
        );
        await this.saveSyncLog(headerError);
        return headerError;
      }

      let totalRows = 0;
      let processedRows = 0;
      let updatedRows = 0;
      let skippedRows = 0;
      const errors: ExcelRowError[] = [];
      const seenIds = new Set<number>();
      const seenEmails = new Set<string>();

      for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber++) {
        const row = worksheet.getRow(rowNumber);
        const record = this.mapRowToCandidate(row, headerMap);

        if (!record) {
          continue;
        }

        totalRows++;
        processedRows++;

        if (seenIds.has(record.id)) {
          skippedRows++;
          errors.push({
            row: rowNumber,
            candidateId: record.id,
            error: `Duplicate candidate ID ${record.id} encountered in workbook; subsequent row skipped.`,
          });
          continue;
        }
        seenIds.add(record.id);

        if (record.email) {
          const normEmail = record.email.trim().toLowerCase();
          if (seenEmails.has(normEmail)) {
            skippedRows++;
            errors.push({
              row: rowNumber,
              candidateId: record.id,
              error: `Duplicate candidate email "${normEmail}" encountered in workbook.`,
            });
            continue;
          }
          seenEmails.add(normEmail);
        }

        // Notify HR if newly shortlisted and HR assigned
        const isShortlisted =
          record.screeningStatus === 'SHORTLIST' ||
          String(record.applicationStatus).toUpperCase().includes('SHORTLIST');

        if (
          isShortlisted &&
          record.notificationStatus !== 'SENT' &&
          (record.assignedHrEmail ||
            (record.assignedHrName && record.assignedHrName !== 'Unassigned'))
        ) {
          try {
            await this.candidateNotificationService.notifyAssignedHr(record);
          } catch (notifErr: any) {
            this.logger.warn(
              `Notification failed during sync for candidate ${record.id}: ${notifErr.message}`,
            );
          }
        }

        updatedRows++;
      }

      const syncStatus =
        errors.length === 0
          ? ExcelSyncStatus.Success
          : updatedRows > 0
            ? ExcelSyncStatus.Partial
            : ExcelSyncStatus.Failed;

      const finalResult: ExcelSyncResult = {
        status: syncStatus,
        fileHash,
        totalRows,
        processedRows,
        updatedRows,
        skippedRows,
        errorCount: errors.length,
        errors,
        startedAt,
        completedAt: new Date(),
        durationMs: Date.now() - startTime,
        triggerSource,
        message: `Validated ${processedRows} candidates in local Excel (${updatedRows} valid, ${errors.length} errors)`,
      };

      await this.saveSyncLog(finalResult);
      return finalResult;
    } finally {
      this.isSyncInProgress = false;
    }
  }

  private async saveSyncLog(result: ExcelSyncResult): Promise<void> {
    try {
      await this.prisma.excelSyncLog.create({
        data: {
          fileHash: result.fileHash || null,
          status: result.status,
          totalRows: result.totalRows,
          processedRows: result.processedRows,
          updatedRows: result.updatedRows,
          skippedRows: result.skippedRows,
          errorCount: result.errorCount,
          errors: result.errors as any,
          startedAt: result.startedAt,
          completedAt: result.completedAt,
          durationMs: result.durationMs,
          triggerSource: result.triggerSource,
        },
      });
    } catch (err: any) {
      this.logger.warn(`Could not save ExcelSyncLog: ${err.message}`);
    }
  }

  public async getSyncStatus(): Promise<{
    enabled: boolean;
    excelPath: string;
    fileExists: boolean;
    intervalMinutes: number;
    lastSync?: any;
    totalCandidates: number;
    isSyncInProgress: boolean;
    lastFileHash?: string | null;
    lastRunMetrics?: any;
    nextScheduledCheckEstimate?: string | null;
  }> {
    const fileExists = fs.existsSync(this.config.path);
    let totalCandidates = 0;

    if (fileExists) {
      try {
        const stats = await this.getDashboardStats();
        totalCandidates = stats.totalCandidates ?? stats.total ?? 0;
      } catch {}
    }

    let lastSync: any = null;
    try {
      lastSync = await this.prisma.excelSyncLog.findFirst({
        orderBy: { completedAt: 'desc' },
      });
    } catch {}

    const lastRunMetrics = lastSync
      ? {
          status: lastSync.status,
          totalRows: lastSync.totalRows,
          updatedRows: lastSync.updatedRows,
          errorCount: lastSync.errorCount,
        }
      : null;

    const nextScheduledCheckEstimate = lastSync?.completedAt
      ? new Date(
          new Date(lastSync.completedAt).getTime() +
            this.config.intervalMinutes * 60 * 1000,
        ).toISOString()
      : null;

    return {
      enabled: this.config.enabled,
      excelPath: this.config.path,
      fileExists,
      intervalMinutes: this.config.intervalMinutes,
      lastSync,
      totalCandidates,
      isSyncInProgress: this.isSyncInProgress,
      lastFileHash: lastSync?.fileHash || null,
      lastRunMetrics,
      nextScheduledCheckEstimate,
    };
  }

  public async getSyncLogs(
    page: number = 1,
    limit: number = 20,
  ): Promise<{
    logs: any[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.max(1, Math.min(100, Number(limit) || 20));
    const skip = (pageNum - 1) * limitNum;

    const [total, logs] = await Promise.all([
      this.prisma.excelSyncLog.count(),
      this.prisma.excelSyncLog.findMany({
        skip,
        take: limitNum,
        orderBy: { completedAt: 'desc' },
      }),
    ]);

    return {
      logs,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
    };
  }
}

// Export backwards-compatible alias
export { CandidateExcelService as CandidateExcelSyncService };
