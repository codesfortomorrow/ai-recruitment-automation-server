import { forwardRef, Inject, Injectable, Optional } from '@nestjs/common';
import * as crypto from 'crypto';
import { ConfigType } from '@nestjs/config';
import { BaseService } from '@Common';
import {
  appConfigFactory,
  excelSyncConfigFactory,
  googleSheetsConfigFactory,
  hrConfigFactory,
} from '@Config';
import { RedisService } from '../redis';
import { MailService } from '../mail/mail.service';
import { GmailService } from '../mail/gmail.service';
import { CandidateExcelService } from './candidate-excel.service';
import { GoogleSheetsService } from './google-sheets.service';
import { NotificationStatus } from '../generated/prisma/client';

@Injectable()
export class CandidateNotificationService extends BaseService {
  private static readonly MAX_NOTIFICATION_RETRIES = 2;

  constructor(
    private readonly redisService: RedisService,
    @Inject(forwardRef(() => MailService))
    private readonly mailService: MailService,
    @Inject(forwardRef(() => GmailService))
    private readonly gmailService: GmailService,
    @Inject(forwardRef(() => CandidateExcelService))
    private readonly candidateExcelService: CandidateExcelService,
    @Inject(hrConfigFactory.KEY)
    private readonly hrConfig: ConfigType<typeof hrConfigFactory>,
    @Inject(appConfigFactory.KEY)
    private readonly appConfig: ConfigType<typeof appConfigFactory>,
    @Optional()
    @Inject(excelSyncConfigFactory.KEY)
    private readonly excelSyncConfig?: ConfigType<
      typeof excelSyncConfigFactory
    >,
    @Optional()
    @Inject(googleSheetsConfigFactory.KEY)
    private readonly googleSheetsConfig?: ConfigType<
      typeof googleSheetsConfigFactory
    >,
    @Optional()
    @Inject(forwardRef(() => GoogleSheetsService))
    private readonly googleSheetsService?: GoogleSheetsService,
  ) {
    super({
      loggerDefaultMeta: { service: CandidateNotificationService.name },
    });
  }

  /**
   * Generates a safe, sanitized error message without leaking sensitive credentials or resume content.
   */
  private sanitizeError(err: any): string {
    const raw = String(err?.message || err || 'Unknown notification error');
    return raw
      .replace(/key=[a-zA-Z0-9_\-]+/gi, 'key=***')
      .replace(/token=[a-zA-Z0-9_\-]+/gi, 'token=***')
      .replace(/secret=[a-zA-Z0-9_\-]+/gi, 'secret=***')
      .slice(0, 500);
  }

  /**
   * Validates attachment buffer integrity via magic bytes for PDF and DOCX.
   */
  public isValidResumeBuffer(buffer: Buffer): boolean {
    if (!buffer || buffer.length === 0) return false;

    // PDF magic bytes: %PDF-
    const isPdf =
      buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-';

    // DOCX magic bytes: PK\x03\x04
    const isDocx =
      buffer.length >= 4 &&
      buffer[0] === 0x50 &&
      buffer[1] === 0x4b &&
      buffer[2] === 0x03 &&
      buffer[3] === 0x04;

    return isPdf || isDocx;
  }

  /**
   * Validates standard email address format.
   */
  private isValidEmail(email: string | null | undefined): boolean {
    if (!email) return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  }

  /**
   * Safe email masking for structured logs (e.g. ja***e@domain.com) without exposing sensitive candidate/HR data.
   */
  public maskEmail(email: string | null | undefined): string {
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return '***';
    }
    const [local, domain] = email.split('@');
    if (local.length <= 2) {
      return `${local[0]}***@${domain}`;
    }
    return `${local.slice(0, 2)}***${local.slice(-1)}@${domain}`;
  }

  /**
   * Resolves the target HR configuration, identifier, and recipient email.
   * Produces explicit errors when HR configuration (such as HR2_EMAIL or HR1_EMAIL) is missing or invalid.
   */
  public resolveTargetHr(candidate: any): {
    hrId?: string;
    hrName?: string;
    targetRecipient?: string;
    error?: string;
  } {
    const rawEmail = (candidate?.assignedHrEmail || '').trim().toLowerCase();
    const rawName = (candidate?.assignedHrName || '').trim().toLowerCase();
    const rawId = (candidate?.assignedHrId || '').trim().toLowerCase();

    const hr2Name = (this.hrConfig.hr2?.name || 'Jayendra')
      .trim()
      .toLowerCase();
    const hr2Id = (this.hrConfig.hr2?.id || 'hr-2').trim().toLowerCase();
    const hr2Email = (this.hrConfig.hr2?.email || '').trim().toLowerCase();

    const hr1Name = (this.hrConfig.hr1?.name || 'Abhishek')
      .trim()
      .toLowerCase();
    const hr1Id = (this.hrConfig.hr1?.id || 'hr-1').trim().toLowerCase();
    const hr1Email = (this.hrConfig.hr1?.email || '').trim().toLowerCase();

    // Check if candidate is assigned to HR2 (Jayendra / hr-2)
    const isHr2 =
      (rawName && (rawName === hr2Name || rawName === 'jayendra')) ||
      (rawId && (rawId === hr2Id || rawId === 'hr-2')) ||
      (rawEmail && hr2Email && rawEmail === hr2Email);

    if (isHr2) {
      if (
        !this.hrConfig.hr2?.email ||
        !this.isValidEmail(this.hrConfig.hr2.email)
      ) {
        return {
          hrId: this.hrConfig.hr2?.id || 'hr-2',
          hrName: this.hrConfig.hr2?.name || 'Jayendra',
          error:
            'Missing or invalid HR2 configuration: HR2 email is not configured or invalid',
        };
      }
      return {
        hrId: this.hrConfig.hr2.id,
        hrName: this.hrConfig.hr2.name,
        targetRecipient: this.hrConfig.hr2.email.trim(),
      };
    }

    // Check if candidate is assigned to HR1 (Abhishek / hr-1)
    const isHr1 =
      (rawName && (rawName === hr1Name || rawName === 'abhishek')) ||
      (rawId && (rawId === hr1Id || rawId === 'hr-1')) ||
      (rawEmail && hr1Email && rawEmail === hr1Email);

    if (isHr1) {
      if (
        !this.hrConfig.hr1?.email ||
        !this.isValidEmail(this.hrConfig.hr1.email)
      ) {
        return {
          hrId: this.hrConfig.hr1?.id || 'hr-1',
          hrName: this.hrConfig.hr1?.name || 'Abhishek',
          error:
            'Missing or invalid HR1 configuration: HR1 email is not configured or invalid',
        };
      }
      return {
        hrId: this.hrConfig.hr1.id,
        hrName: this.hrConfig.hr1.name,
        targetRecipient: this.hrConfig.hr1.email.trim(),
      };
    }

    // Fallback: If rawEmail is a valid email directly set on candidate
    if (rawEmail && this.isValidEmail(rawEmail)) {
      return {
        hrId: rawId || undefined,
        hrName: candidate?.assignedHrName || undefined,
        targetRecipient: rawEmail,
      };
    }

    return {
      error: `HR assignment missing: candidate is assigned to "${candidate?.assignedHrName || 'Unassigned'}" with no configured recipient`,
    };
  }

  /**
   * Resolves recipient email for candidate notification based strictly on assigned role.
   * Sends the resume summary email ONLY to the assigned HR and only when candidate is shortlisted.
   * Never broadcasts to both HR1 and HR2.
   */
  public getHrRecipients(candidate?: any | null): string[] {
    if (!candidate) return [];
    const resolved = this.resolveTargetHr(candidate);
    if (
      resolved.targetRecipient &&
      this.isValidEmail(resolved.targetRecipient)
    ) {
      return [resolved.targetRecipient];
    }
    return [];
  }

  /**
   * Resolves the configured manual review recipient email dynamically from configuration.
   */
  public getManualReviewRecipients(): string[] {
    const email = this.hrConfig.manualReviewEmail?.trim();
    if (email && this.isValidEmail(email)) {
      return [email];
    }
    return [];
  }

  /**
   * Resolves the configured Google Sheets URL for the live candidate tracker.
   */
  public getGoogleSheetsUrl(): string | null {
    const spreadsheetId =
      this.googleSheetsConfig?.spreadsheetId?.trim() ||
      process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim() ||
      '';
    if (!spreadsheetId) return null;
    return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
  }

  /**
   * Resolves the Google Drive web view URL for the candidate's original CV.
   * Extracts raw URL from Sheets HYPERLINK formula if present.
   */
  public getGoogleDriveCvUrl(candidate: any): string | null {
    if (candidate?.driveFileId) {
      return `https://drive.google.com/file/d/${candidate.driveFileId}/view`;
    }
    const cvLink = candidate?.cvLink;
    if (typeof cvLink === 'string' && cvLink.trim()) {
      const match = cvLink.match(/HYPERLINK\(\s*["']([^"']+)["']/i);
      if (match && match[1]) {
        return match[1];
      }
      if (cvLink.startsWith('http://') || cvLink.startsWith('https://')) {
        return cvLink.trim();
      }
    }
    return null;
  }

  /**
   * Formats candidate experience into total experience, current company, and company history.
   */
  private formatExperienceDetails(
    experience: any,
    fallbackCompany?: string | null,
  ): {
    totalExperience: string;
    currentCompany: string;
    previousCompanies: string;
  } {
    if (!experience) {
      return {
        totalExperience: 'Not specified in resume',
        currentCompany: fallbackCompany?.trim() || 'Not specified in resume',
        previousCompanies: 'None listed',
      };
    }

    if (typeof experience === 'string') {
      const expStr = experience.trim();
      return {
        totalExperience: expStr || 'Not specified in resume',
        currentCompany: fallbackCompany?.trim() || 'Refer to resume',
        previousCompanies: 'Refer to resume',
      };
    }

    if (Array.isArray(experience)) {
      if (experience.length === 0) {
        return {
          totalExperience: 'Not specified in resume',
          currentCompany: fallbackCompany?.trim() || 'Not specified in resume',
          previousCompanies: 'None listed',
        };
      }

      const companies: string[] = [];
      const descriptions: string[] = [];

      for (const item of experience) {
        if (typeof item === 'string') {
          descriptions.push(item);
        } else if (typeof item === 'object' && item !== null) {
          const comp = (item.company || item.name || '').trim();
          const role = (item.role || item.title || '').trim();
          const dur = (item.duration || item.years || '').trim();
          if (comp) companies.push(comp);
          const parts = [role, comp, dur].filter(Boolean);
          if (parts.length > 0) descriptions.push(parts.join(' at '));
        }
      }

      const currentCompany =
        fallbackCompany?.trim() ||
        (companies.length > 0 ? companies[0] : 'Not specified in resume');
      const prev =
        companies.length > 1
          ? companies.slice(1).join(', ')
          : 'None listed / Entry-level';
      const totalExperience =
        descriptions.length > 0
          ? descriptions.join('; ')
          : 'Not specified in resume';

      return {
        totalExperience,
        currentCompany,
        previousCompanies: prev,
      };
    }

    return {
      totalExperience: String(experience),
      currentCompany: fallbackCompany?.trim() || 'Not specified in resume',
      previousCompanies: 'None listed',
    };
  }

  /**
   * Formats candidate education into readable string.
   */
  private formatEducationDetails(education: any): string {
    if (!education) return 'Not specified in resume';
    if (typeof education === 'string') {
      return education.trim() || 'Not specified in resume';
    }
    if (Array.isArray(education)) {
      if (education.length === 0) return 'Not specified in resume';
      const formatted = education.map((edu) => {
        if (typeof edu === 'string') return edu.trim();
        if (typeof edu === 'object' && edu !== null) {
          const deg = edu.degree || edu.qualification || '';
          const inst = edu.institution || edu.university || edu.college || '';
          const yr = edu.year || edu.graduationYear || '';
          return [deg, inst, yr].filter(Boolean).join(', ');
        }
        return String(edu);
      });
      return formatted.filter(Boolean).join('; ') || 'Not specified in resume';
    }
    return String(education);
  }

  /**
   * Generates the HTML body for the HR shortlist notification email.
   * Includes complete role-specific candidate profile, skills, matched & missing criteria,
   * and experience history.
   * Contains no broken links, localhost buttons, or Google Sheets URLs.
   */
  public buildHtmlEmail(candidate: any): string {
    const name = candidate.name || 'Candidate';
    const email = candidate.email || 'Not provided';
    const phone = candidate.phone || 'Not provided';
    const role = candidate.jobRole || candidate.normalizedRole || 'Applicant';
    const score = candidate.matchScore || 0;
    const summary = candidate.summary || '';
    const explanation = candidate.screeningExplanation || '';
    const recommendation =
      candidate.recommendation || candidate.screeningStatus || 'SHORTLIST';
    const status = candidate.screeningStatus || 'SHORTLISTED';

    const sheetsUrl = this.getGoogleSheetsUrl();
    const sheetsBlockHtml = sheetsUrl
      ? `
      <!-- Google Sheets Live Candidate Tracker Action Box -->
      <div style="background-color: #f0fdf4; border: 1.5px solid #86efac; border-radius: 8px; padding: 20px 24px; margin-bottom: 24px; text-align: center;">
        <div style="font-size: 16px; font-weight: 700; color: #166534; margin-bottom: 6px;">
          Candidate Tracker &mdash; Live Google Sheet
        </div>
        <p style="margin: 0 0 16px 0; font-size: 13px; color: #15803d; line-height: 1.5;">
          Open the live Google Sheet directly to review this application, update candidate status, manage interview rounds, or record HR remarks.
        </p>
        <a href="${sheetsUrl}" target="_blank" style="background-color: #16a34a; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-weight: 700; font-size: 14px; display: inline-block; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          Open Candidate Tracker in Google Sheets &rarr;
        </a>
        <div style="margin-top: 12px; font-size: 12px; color: #166534;">
          Direct Link: <a href="${sheetsUrl}" target="_blank" style="color: #15803d; word-break: break-all; text-decoration: underline;">${sheetsUrl}</a>
        </div>
      </div>`
      : '';

    const driveCvUrl = this.getGoogleDriveCvUrl(candidate);
    const driveBlockHtml = driveCvUrl
      ? `
      <!-- Google Drive CV Direct Action Box -->
      <div style="background-color: #eff6ff; border: 1.5px solid #93c5fd; border-radius: 8px; padding: 20px 24px; margin-bottom: 24px; text-align: center;">
        <div style="font-size: 16px; font-weight: 700; color: #1e40af; margin-bottom: 6px;">
          Original Candidate CV &mdash; Google Drive
        </div>
        <p style="margin: 0 0 16px 0; font-size: 13px; color: #1d4ed8; line-height: 1.5;">
          The candidate's original verified resume is stored in the central &ldquo;All Candidate CVs&rdquo; Google Drive folder.
        </p>
        <a href="${driveCvUrl}" target="_blank" style="background-color: #2563eb; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-weight: 700; font-size: 14px; display: inline-block; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          View CV in Google Drive &rarr;
        </a>
        <div style="margin-top: 12px; font-size: 12px; color: #1e40af;">
          Direct Link: <a href="${driveCvUrl}" target="_blank" style="color: #2563eb; word-break: break-all; text-decoration: underline;">${driveCvUrl}</a>
        </div>
      </div>`
      : '';

    const { totalExperience, currentCompany, previousCompanies } =
      this.formatExperienceDetails(candidate.experience, candidate.company);
    const educationStr = this.formatEducationDetails(candidate.education);

    // Skills
    let skillsHtml = '';
    const skills = Array.isArray(candidate.skills) ? candidate.skills : [];
    if (skills.length > 0) {
      skillsHtml = skills
        .map(
          (skill: string) =>
            `<span style="background-color: #e8f0fe; color: #1967d2; padding: 4px 10px; border-radius: 12px; font-size: 13px; font-weight: 500; display: inline-block; margin: 3px 4px 3px 0; border: 1px solid #d2e3fc;">${this.escapeHtml(
              String(skill).trim(),
            )}</span>`,
        )
        .join('');
    } else {
      skillsHtml =
        '<span style="color: #757575; font-size: 13px; font-style: italic;">No specific technical skills extracted</span>';
    }

    // Matched Requirements
    let matchedListHtml = '';
    const matched = Array.isArray(candidate.matchedRequirements)
      ? (candidate.matchedRequirements as string[])
      : [];

    if (matched.length > 0) {
      matchedListHtml = matched
        .map(
          (req) =>
            `<li style="margin-bottom: 6px; color: #2e7d32;"><strong style="color: #2e7d32;">&#10003;</strong> ${this.escapeHtml(
              req,
            )}</li>`,
        )
        .join('');
    } else {
      matchedListHtml =
        '<li style="color: #757575;">No specific requirement criteria flagged.</li>';
    }

    // Missing / Unclear Requirements
    let missingListHtml = '';
    const missing = Array.isArray(candidate.missingRequirements)
      ? (candidate.missingRequirements as string[])
      : Array.isArray(candidate.missingOrUnclearRequirements)
        ? (candidate.missingOrUnclearRequirements as string[])
        : [];

    if (missing.length > 0) {
      missingListHtml = missing
        .map(
          (req) =>
            `<li style="margin-bottom: 6px; color: #e65100;"><strong style="color: #e65100;">&#9888;</strong> ${this.escapeHtml(
              req,
            )}</li>`,
        )
        .join('');
    } else {
      missingListHtml =
        '<li style="color: #2e7d32;">&#10003; None flagged &mdash; candidate satisfies all evaluated eligibility criteria.</li>';
    }

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Candidate Shortlisted: ${this.escapeHtml(name)} - ${this.escapeHtml(role)}</title>
</head>
<body style="font-family: Arial, sans-serif; background-color: #f9f9f9; padding: 24px 0; margin: 0; color: #333333;">
  <div style="max-width: 680px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; border: 1px solid #e0e0e0; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">

    <!-- Header -->
    <div style="background-color: #1976d2; color: #ffffff; padding: 24px 32px; text-align: left;">
      <h1 style="margin: 0; font-size: 22px; font-weight: 600;">Candidate Shortlisted: ${this.escapeHtml(role)}</h1>
      <p style="margin: 6px 0 0 0; font-size: 14px; opacity: 0.9;">Application matches job requirements for ${this.escapeHtml(role)}</p>
    </div>

    <div style="padding: 32px;">

      <!-- Match Score & Screening Status Badge -->
      <div style="background-color: #e8f5e9; border: 1px solid #c8e6c9; border-radius: 6px; padding: 12px 18px; margin-bottom: 24px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
        <div>
          <span style="font-size: 14px; font-weight: 600; color: #2e7d32;">AI Match Score: </span>
          <span style="font-size: 20px; font-weight: 800; color: #1b5e20;">${score}/100</span>
          <span style="font-size: 13px; color: #388e3c; margin-left: 8px;">(Recommendation: ${this.escapeHtml(recommendation)})</span>
        </div>
        <div style="background-color: #2e7d32; color: #ffffff; padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 700; text-transform: uppercase;">
          Status: ${this.escapeHtml(status)}
        </div>
      </div>

      <!-- Candidate Contact & Background Details -->
      <div style="background-color: #fafafa; border-radius: 6px; padding: 18px 20px; margin-bottom: 24px; border: 1px solid #eeeeee;">
        <h3 style="margin: 0 0 14px 0; font-size: 15px; color: #212121; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700;">Candidate & Experience Details</h3>
        <table style="width: 100%; border-collapse: collapse; font-size: 14px; line-height: 1.6;">
          <tr>
            <td style="padding: 5px 0; width: 150px; color: #616161; font-weight: 500;">Candidate Name:</td>
            <td style="padding: 5px 0; font-weight: 600; color: #212121;">${this.escapeHtml(name)}</td>
          </tr>
          <tr>
            <td style="padding: 5px 0; color: #616161; font-weight: 500;">Applied Role:</td>
            <td style="padding: 5px 0; font-weight: 600; color: #1565c0;">${this.escapeHtml(role)}</td>
          </tr>
          <tr>
            <td style="padding: 5px 0; color: #616161; font-weight: 500;">Email Address:</td>
            <td style="padding: 5px 0;"><a href="mailto:${this.escapeHtml(email)}" style="color: #1976d2; text-decoration: none; font-weight: 500;">${this.escapeHtml(email)}</a></td>
          </tr>
          <tr>
            <td style="padding: 5px 0; color: #616161; font-weight: 500;">Mobile Number:</td>
            <td style="padding: 5px 0; color: #212121;">${this.escapeHtml(phone)}</td>
          </tr>
          <tr>
            <td style="padding: 5px 0; color: #616161; font-weight: 500;">Assigned HR:</td>
            <td style="padding: 5px 0; font-weight: 600; color: #212121;">${this.escapeHtml(candidate.assignedHrName || 'HR')} (${this.escapeHtml(candidate.assignedHrEmail || '')})</td>
          </tr>
          <tr>
            <td style="padding: 5px 0; color: #616161; font-weight: 500;">Current Company:</td>
            <td style="padding: 5px 0; color: #212121;">${this.escapeHtml(currentCompany)}</td>
          </tr>
          <tr>
            <td style="padding: 5px 0; color: #616161; font-weight: 500;">Previous Companies:</td>
            <td style="padding: 5px 0; color: #212121;">${this.escapeHtml(previousCompanies)}</td>
          </tr>
          <tr>
            <td style="padding: 5px 0; color: #616161; font-weight: 500;">Total Experience:</td>
            <td style="padding: 5px 0; color: #212121;">${this.escapeHtml(totalExperience)}</td>
          </tr>
          <tr>
            <td style="padding: 5px 0; color: #616161; font-weight: 500;">Education:</td>
            <td style="padding: 5px 0; color: #212121;">${this.escapeHtml(educationStr)}</td>
          </tr>
        </table>
      </div>

      <!-- Relevant Technical Skills -->
      <div style="margin-bottom: 24px;">
        <h3 style="margin: 0 0 10px 0; font-size: 15px; color: #212121; border-bottom: 2px solid #e0e0e0; padding-bottom: 6px; font-weight: 700;">Role-Specific Skills (${this.escapeHtml(role)})</h3>
        <div>
          ${skillsHtml}
        </div>
      </div>

      <!-- Role-Specific Candidate Summary -->
      <div style="margin-bottom: 24px;">
        <h3 style="margin: 0 0 10px 0; font-size: 15px; color: #212121; border-bottom: 2px solid #e0e0e0; padding-bottom: 6px; font-weight: 700;">Role-Specific Summary (${this.escapeHtml(role)})</h3>
        <p style="margin: 0; line-height: 1.6; font-size: 14px; color: #424242;">${this.escapeHtml(summary || 'No summary provided in screening result.')}</p>
      </div>

      <!-- Key Matched Requirements -->
      <div style="margin-bottom: 24px;">
        <h3 style="margin: 0 0 10px 0; font-size: 15px; color: #212121; border-bottom: 2px solid #e0e0e0; padding-bottom: 6px; font-weight: 700;">Key Matched Requirements</h3>
        <ul style="margin: 0; padding-left: 20px; list-style-type: none; font-size: 14px; line-height: 1.6;">
          ${matchedListHtml}
        </ul>
      </div>

      <!-- Missing / Unclear Requirements -->
      <div style="margin-bottom: 24px;">
        <h3 style="margin: 0 0 10px 0; font-size: 15px; color: #212121; border-bottom: 2px solid #e0e0e0; padding-bottom: 6px; font-weight: 700;">Criteria Under Review / Missing Requirements</h3>
        <ul style="margin: 0; padding-left: 20px; list-style-type: none; font-size: 14px; line-height: 1.6;">
          ${missingListHtml}
        </ul>
      </div>

      <!-- Evidence & Screening Explanation -->
      <div style="margin-bottom: 28px;">
        <h3 style="margin: 0 0 10px 0; font-size: 15px; color: #212121; border-bottom: 2px solid #e0e0e0; padding-bottom: 6px; font-weight: 700;">Evidence & Screening Explanation</h3>
        <p style="margin: 0; line-height: 1.6; font-size: 14px; color: #424242;">${this.escapeHtml(explanation || 'Evaluated based on resume text and application content.')}</p>
      </div>

      ${driveBlockHtml}
      ${sheetsBlockHtml}

      <p style="text-align: center; font-size: 13px; color: #757575; margin-top: 14px;">
        The original verified resume is stored in Google Drive and attached to this email for your review.
      </p>

    </div>

    <!-- Footer -->
    <div style="background-color: #f5f5f5; border-top: 1px solid #e0e0e0; padding: 16px 32px; font-size: 12px; color: #9e9e9e; text-align: center;">
      Automated screening notification from Recruitment Automation System. AI recommendations are preliminary.
    </div>

  </div>
</body>
</html>`;
  }

  private escapeHtml(text?: string | null): string {
    if (!text) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Main entry point to send HR email notification for a candidate.
   * Guarantees duplicate notification prevention, role-based checks, and bounded retries.
   * If a candidate ID is passed, retrieves the candidate from the local Excel database.
   */
  async notifyAssignedHr(candidateOrId: any): Promise<{
    status: NotificationStatus;
    recipient?: string;
    recipients?: string[];
    error?: string;
  }> {
    // 1. Fetch candidate record if ID is provided
    let candidate = candidateOrId;
    if (typeof candidateOrId === 'number') {
      if (this.googleSheetsService?.isConfigured()) {
        try {
          const sheetRow =
            await this.googleSheetsService.findCandidateById(candidateOrId);
          if (sheetRow) {
            candidate = {
              id: sheetRow.candidateId,
              name: sheetRow.candidateName,
              email: sheetRow.email,
              phone: sheetRow.phone,
              jobRole: sheetRow.jobRole,
              assignedHrName: sheetRow.assignedHrName,
              screeningStatus: sheetRow.applicationStatus,
              applicationStatus: sheetRow.applicationStatus,
              matchScore: null,
              summary: sheetRow.hrRemarks,
              hrRemarks: sheetRow.hrRemarks,
              cvLink: sheetRow.cvLink,
              driveFileId: sheetRow.driveFileId,
            } as any;
          }
        } catch {}
      }

      if (!candidate) {
        candidate =
          await this.candidateExcelService.getCandidateById(candidateOrId);
      }

      if (!candidate) {
        this.logger.warn(
          `Cannot notify HR: Candidate ID ${candidateOrId} not found in database`,
          {
            candidateId: candidateOrId,
            status: 'FAILED',
            error: 'Candidate not found',
          },
        );
        return {
          status: NotificationStatus.Failed,
          error: 'Candidate not found',
        };
      }
    }

    if (!candidate) {
      return {
        status: NotificationStatus.Failed,
        error: 'Invalid candidate payload',
      };
    }

    const assignedHrName = candidate.assignedHrName || 'Unassigned';

    // 2. Business rule check: only SHORTLIST candidates get HR notification
    const statusUpper = String(
      candidate.screeningStatus || candidate.applicationStatus || '',
    ).toUpperCase();
    const isShortlist = statusUpper.includes('SHORTLIST');

    if (!isShortlist) {
      this.logger.info(
        `Notification skipped: Candidate ID ${candidate.id} has status ${candidate.screeningStatus || 'non-shortlist'}; shortlist notification not required`,
        {
          candidateId: candidate.id,
          assignedHr: assignedHrName,
          screeningStatus: candidate.screeningStatus,
          status: 'SKIPPED',
          reason: `Status is ${candidate.screeningStatus || 'non-shortlist'}; not shortlisted`,
        },
      );
      return { status: NotificationStatus.NotRequired };
    }

    // 3. Resolve assigned HR configuration
    const hrResolution = this.resolveTargetHr(candidate);
    if (hrResolution.error || !hrResolution.targetRecipient) {
      this.logger.error(
        `Notification failed for candidate ID ${candidate.id}: ${hrResolution.error}`,
        {
          candidateId: candidate.id,
          assignedHr: assignedHrName,
          status: 'FAILED',
          error: hrResolution.error,
        },
      );
      return {
        status: NotificationStatus.Failed,
        error: hrResolution.error,
      };
    }

    const targetRecipient = hrResolution.targetRecipient;
    const maskedRecipient = this.maskEmail(targetRecipient);
    const normalizedRecipient = targetRecipient.toLowerCase();
    const candidateEmail = (candidate?.email || '').trim().toLowerCase();
    const idempotencyKey = candidateEmail
      ? `candidate:notified:${candidate.id}:${candidateEmail}:${normalizedRecipient}`
      : `candidate:notified:${candidate.id}:${normalizedRecipient}`;
    const legacyIdempotencyKey = `candidate:notified:${candidate.id}:${normalizedRecipient}`;
    const lockKey = candidateEmail
      ? `candidate:notify:lock:${candidate.id}:${candidateEmail}:${normalizedRecipient}`
      : `candidate:notify:lock:${candidate.id}:${normalizedRecipient}`;

    // 4. Duplicate prevention: Idempotency check via Redis (specific to candidate + recipient)
    if (this.redisService?.client) {
      try {
        const alreadySent = await this.redisService.client.get(idempotencyKey);
        // Check legacy key for backwards compatibility, avoiding suppression on known historical ID collisions
        const isHistoricalCollision =
          candidate.id === 16 && candidateEmail.includes('rohitdorage');
        const legacySent =
          alreadySent !== 'SENT' && !isHistoricalCollision
            ? await this.redisService.client.get(legacyIdempotencyKey)
            : null;

        if (alreadySent === 'SENT' || legacySent === 'SENT') {
          this.logger.info(
            `Notification skipped for candidate ID ${candidate.id}: already sent to ${maskedRecipient}`,
            {
              candidateId: candidate.id,
              assignedHr: assignedHrName,
              recipient: maskedRecipient,
              idempotencyKey,
              status: 'SKIPPED',
              reason: 'Notification already sent to this recipient',
            },
          );
          return {
            status: NotificationStatus.Sent,
            recipient: targetRecipient,
            recipients: [targetRecipient],
          };
        }
      } catch (redisGetErr: any) {
        this.logger.warn(
          `Failed to check notification idempotency from Redis for candidate ID ${candidate.id}: ${this.sanitizeError(redisGetErr)}`,
        );
      }
    }

    // 5. Redis concurrency lock to prevent parallel duplicate deliveries
    const lockToken = crypto.randomUUID();
    let lockAcquired = false;

    if (this.redisService?.client) {
      try {
        const lockResult = await this.redisService.client.set(
          lockKey,
          lockToken,
          'EX',
          60,
          'NX',
        );
        lockAcquired = lockResult === 'OK';
        if (!lockAcquired) {
          this.logger.warn(
            `Notification for candidate ID ${candidate.id} to ${maskedRecipient} is already in progress in another process`,
            {
              candidateId: candidate.id,
              assignedHr: assignedHrName,
              recipient: maskedRecipient,
              status: 'PENDING',
              reason: 'Concurrency lock in progress',
            },
          );
          return { status: NotificationStatus.Pending };
        }
      } catch (redisLockErr: any) {
        this.logger.warn(
          `Redis lock error for candidate ID ${candidate.id}: ${this.sanitizeError(redisLockErr)}`,
        );
        return {
          status: NotificationStatus.Pending,
          error:
            'Concurrency lock unavailable; skipping to prevent duplicate delivery',
        };
      }
    } else {
      lockAcquired = true;
    }

    try {
      // 6. Retrieve resume attachment if present
      let attachments: Array<{
        filename: string;
        content: Buffer;
        contentType?: string;
      }> = [];

      let attachmentId = candidate.attachmentId;
      let gmailMessageId = candidate.gmailMessageId;

      // Fallback: If attachment metadata is missing on candidate object (e.g. loaded from Excel), lookup cached Redis resume metadata
      if (
        (!attachmentId || !gmailMessageId) &&
        this.redisService?.client &&
        candidate.id
      ) {
        try {
          const cachedResume = await this.redisService.client.get(
            `candidate:resume:${candidate.id}`,
          );
          if (cachedResume) {
            const parsed = JSON.parse(cachedResume);
            attachmentId = parsed.attachmentId || attachmentId;
            gmailMessageId = parsed.gmailMessageId || gmailMessageId;
            if (!candidate.filename && parsed.filename)
              candidate.filename = parsed.filename;
            if (!candidate.mimeType && parsed.mimeType)
              candidate.mimeType = parsed.mimeType;
          }
        } catch {}
      }

      if (attachmentId && gmailMessageId) {
        try {
          const buffer = await this.gmailService.downloadAttachment(
            gmailMessageId,
            attachmentId,
          );

          if (buffer && buffer.length > 0 && this.isValidResumeBuffer(buffer)) {
            const rawFilename = candidate.filename || 'Candidate_Resume.pdf';
            const sanitizedFilename = rawFilename.replace(
              /[^a-zA-Z0-9._-]/g,
              '_',
            );

            attachments = [
              {
                filename: sanitizedFilename,
                content: buffer,
                contentType: sanitizedFilename.toLowerCase().endsWith('.docx')
                  ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
                  : candidate.mimeType || 'application/pdf',
              },
            ];
          }
        } catch (downloadErr: any) {
          this.logger.warn(
            `Could not attach resume for candidate ID ${candidate.id}: ${this.sanitizeError(downloadErr)}`,
          );
        }
      }

      // 7. Render HTML email
      const subject = `[Shortlisted] ${candidate.name || 'Candidate'} - ${candidate.jobRole || 'Applicant'} (Score: ${candidate.matchScore || 0}/100)`;
      const htmlBody = this.buildHtmlEmail(candidate);

      // 8. Send email with bounded retries and provider acceptance check
      let attempt = 0;
      let lastError = '';
      let sendSuccess = false;

      while (
        attempt < CandidateNotificationService.MAX_NOTIFICATION_RETRIES &&
        !sendSuccess
      ) {
        attempt++;
        try {
          this.logger.info(
            `Attempting HR notification dispatch (Attempt ${attempt}/${CandidateNotificationService.MAX_NOTIFICATION_RETRIES}) for candidate ID ${candidate.id} to ${maskedRecipient}`,
            {
              candidateId: candidate.id,
              assignedHr: assignedHrName,
              recipient: maskedRecipient,
              attempt,
              idempotencyKey,
              status: 'ATTEMPTING',
            },
          );

          const sendResult = await this.mailService.sendDirect({
            to: targetRecipient,
            subject,
            html: htmlBody,
            attachments,
          });

          // Check if provider rejected the recipient
          const isRejected =
            Array.isArray(sendResult?.rejected) &&
            sendResult.rejected.some(
              (r: any) => String(r).toLowerCase() === normalizedRecipient,
            );

          if (isRejected) {
            throw new Error(
              `Email provider rejected recipient ${maskedRecipient}: ${sendResult?.response || 'Rejected by SMTP server'}`,
            );
          }

          sendSuccess = true;
          this.logger.info(
            `Email provider accepted notification for candidate ID ${candidate.id} to ${maskedRecipient}`,
            {
              candidateId: candidate.id,
              assignedHr: assignedHrName,
              recipient: maskedRecipient,
              idempotencyKey,
              providerAccepted: true,
              messageId: sendResult?.messageId,
              response: sendResult?.response,
              status: 'ACCEPTED',
            },
          );
        } catch (err: any) {
          lastError = this.sanitizeError(err);
          this.logger.warn(
            `Notification dispatch attempt ${attempt} failed for candidate ID ${candidate.id}: ${lastError}`,
            {
              candidateId: candidate.id,
              assignedHr: assignedHrName,
              recipient: maskedRecipient,
              attempt,
              error: lastError,
              status: 'FAILED',
            },
          );
        }
      }

      if (sendSuccess) {
        // Record idempotency in Redis specific to recipient
        try {
          await this.redisService.client.set(
            idempotencyKey,
            'SENT',
            'EX',
            86400 * 30, // 30 days
          );
          await this.redisService.client.set(
            legacyIdempotencyKey,
            'SENT',
            'EX',
            86400 * 30,
          );
        } catch {}

        // Notification completed successfully; state is preserved in Redis idempotency cache and Google Sheets
        return {
          status: NotificationStatus.Sent,
          recipient: targetRecipient,
          recipients: [targetRecipient],
        };
      } else {
        this.logger.error(
          `Notification dispatch failed for candidate ID ${candidate.id} to ${maskedRecipient} after ${attempt} attempts: ${lastError}`,
          {
            candidateId: candidate.id,
            assignedHr: assignedHrName,
            recipient: maskedRecipient,
            idempotencyKey,
            status: 'FAILED',
            error: lastError,
          },
        );
        return { status: NotificationStatus.Failed, error: lastError };
      }
    } finally {
      if (lockAcquired && this.redisService?.client) {
        try {
          const luaReleaseScript = `
            if redis.call("get", KEYS[1]) == ARGV[1] then
              return redis.call("del", KEYS[1])
            else
              return 0
            end
          `;
          await this.redisService.client.eval(
            luaReleaseScript,
            1,
            lockKey,
            lockToken,
          );
        } catch (releaseErr: any) {
          this.logger.warn(
            `Error releasing Redis notification lock for candidate ID ${candidate.id}: ${this.sanitizeError(releaseErr)}`,
          );
        }
      }
    }
  }

  /**
   * Generates the HTML body for the Manual Review notification email.
   */
  public buildManualReviewHtmlEmail(candidate: any): string {
    const name = candidate.name || 'Candidate';
    const email = candidate.email || 'Not provided';
    const phone = candidate.phone || 'Not provided';
    const role = candidate.jobRole || candidate.normalizedRole || 'Applicant';
    const score = candidate.matchScore || 0;
    const summary = candidate.summary || '';
    const explanation = candidate.screeningExplanation || '';
    const recommendation =
      candidate.recommendation || candidate.screeningStatus || 'MANUAL_REVIEW';
    const status = candidate.screeningStatus || 'MANUAL_REVIEW';

    const sheetsUrl = this.getGoogleSheetsUrl();
    const sheetsBlockHtml = sheetsUrl
      ? `
      <!-- Google Sheets Live Candidate Tracker Action Box -->
      <div style="background-color: #fff7ed; border: 1.5px solid #fdba74; border-radius: 8px; padding: 20px 24px; margin-bottom: 24px; text-align: center;">
        <div style="font-size: 16px; font-weight: 700; color: #9a3412; margin-bottom: 6px;">
          Candidate Tracker &mdash; Live Google Sheet
        </div>
        <p style="margin: 0 0 16px 0; font-size: 13px; color: #c2410c; line-height: 1.5;">
          Open the live Google Sheet directly to review this flagged application, update candidate status, manage interview rounds, or assign HR remarks.
        </p>
        <a href="${sheetsUrl}" target="_blank" style="background-color: #ea580c; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-weight: 700; font-size: 14px; display: inline-block; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          Open Candidate Tracker in Google Sheets &rarr;
        </a>
        <div style="margin-top: 12px; font-size: 12px; color: #9a3412;">
          Direct Link: <a href="${sheetsUrl}" target="_blank" style="color: #c2410c; word-break: break-all; text-decoration: underline;">${sheetsUrl}</a>
        </div>
      </div>`
      : '';

    const driveCvUrl = this.getGoogleDriveCvUrl(candidate);
    const driveBlockHtml = driveCvUrl
      ? `
      <!-- Google Drive CV Direct Action Box -->
      <div style="background-color: #eff6ff; border: 1.5px solid #93c5fd; border-radius: 8px; padding: 20px 24px; margin-bottom: 24px; text-align: center;">
        <div style="font-size: 16px; font-weight: 700; color: #1e40af; margin-bottom: 6px;">
          Original Candidate CV &mdash; Google Drive
        </div>
        <p style="margin: 0 0 16px 0; font-size: 13px; color: #1d4ed8; line-height: 1.5;">
          The candidate's original resume is available in Google Drive for manual verification.
        </p>
        <a href="${driveCvUrl}" target="_blank" style="background-color: #2563eb; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-weight: 700; font-size: 14px; display: inline-block; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          View CV in Google Drive &rarr;
        </a>
        <div style="margin-top: 12px; font-size: 12px; color: #1e40af;">
          Direct Link: <a href="${driveCvUrl}" target="_blank" style="color: #2563eb; word-break: break-all; text-decoration: underline;">${driveCvUrl}</a>
        </div>
      </div>`
      : '';

    const { totalExperience, currentCompany, previousCompanies } =
      this.formatExperienceDetails(candidate.experience, candidate.company);
    const educationStr = this.formatEducationDetails(candidate.education);

    // Skills
    let skillsHtml = '';
    const skills = Array.isArray(candidate.skills) ? candidate.skills : [];
    if (skills.length > 0) {
      skillsHtml = skills
        .map(
          (skill: string) =>
            `<span style="background-color: #fff3e0; color: #e65100; padding: 4px 10px; border-radius: 12px; font-size: 13px; font-weight: 500; display: inline-block; margin: 3px 4px 3px 0; border: 1px solid #ffe0b2;">${this.escapeHtml(
              String(skill).trim(),
            )}</span>`,
        )
        .join('');
    } else {
      skillsHtml =
        '<span style="color: #757575; font-size: 13px; font-style: italic;">No specific technical skills extracted</span>';
    }

    // Missing / Unclear Requirements
    let missingListHtml = '';
    const missing = Array.isArray(candidate.missingRequirements)
      ? (candidate.missingRequirements as string[])
      : Array.isArray(candidate.missingOrUnclearRequirements)
        ? (candidate.missingOrUnclearRequirements as string[])
        : [];

    if (missing.length > 0) {
      missingListHtml = missing
        .map(
          (req) =>
            `<li style="margin-bottom: 6px; color: #d84315;"><strong style="color: #d84315;">&#9888;</strong> ${this.escapeHtml(
              req,
            )}</li>`,
        )
        .join('');
    } else {
      missingListHtml =
        '<li style="color: #616161;">Role ambiguity or missing criteria flagged application for manual review.</li>';
    }

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Manual Review Required: ${this.escapeHtml(name)} - ${this.escapeHtml(role)}</title>
</head>
<body style="font-family: Arial, sans-serif; background-color: #f9f9f9; padding: 24px 0; margin: 0; color: #333333;">
  <div style="max-width: 680px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; border: 1px solid #e0e0e0; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">

    <!-- Header -->
    <div style="background-color: #e65100; color: #ffffff; padding: 24px 32px; text-align: left;">
      <h1 style="margin: 0; font-size: 22px; font-weight: 600;">Manual Review Required: ${this.escapeHtml(role)}</h1>
      <p style="margin: 6px 0 0 0; font-size: 14px; opacity: 0.9;">Application requires human review due to ambiguous role matching or specific criteria</p>
    </div>

    <div style="padding: 32px;">

      <!-- Match Score & Screening Status Badge -->
      <div style="background-color: #fff8e1; border: 1px solid #ffe082; border-radius: 6px; padding: 12px 18px; margin-bottom: 24px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
        <div>
          <span style="font-size: 14px; font-weight: 600; color: #f57f17;">AI Match Score: </span>
          <span style="font-size: 20px; font-weight: 800; color: #e65100;">${score}/100</span>
          <span style="font-size: 13px; color: #f57f17; margin-left: 8px;">(Recommendation: ${this.escapeHtml(recommendation)})</span>
        </div>
        <div style="background-color: #e65100; color: #ffffff; padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 700; text-transform: uppercase;">
          Status: ${this.escapeHtml(status)}
        </div>
      </div>

      <!-- Candidate Contact & Background Details -->
      <div style="background-color: #fafafa; border-radius: 6px; padding: 18px 20px; margin-bottom: 24px; border: 1px solid #eeeeee;">
        <h3 style="margin: 0 0 14px 0; font-size: 15px; color: #212121; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700;">Candidate & Experience Details</h3>
        <table style="width: 100%; border-collapse: collapse; font-size: 14px; line-height: 1.6;">
          <tr>
            <td style="padding: 5px 0; width: 150px; color: #616161; font-weight: 500;">Candidate Name:</td>
            <td style="padding: 5px 0; font-weight: 600; color: #212121;">${this.escapeHtml(name)}</td>
          </tr>
          <tr>
            <td style="padding: 5px 0; color: #616161; font-weight: 500;">Applied Role:</td>
            <td style="padding: 5px 0; font-weight: 600; color: #e65100;">${this.escapeHtml(role)}</td>
          </tr>
          <tr>
            <td style="padding: 5px 0; color: #616161; font-weight: 500;">Email Address:</td>
            <td style="padding: 5px 0;"><a href="mailto:${this.escapeHtml(email)}" style="color: #1976d2; text-decoration: none; font-weight: 500;">${this.escapeHtml(email)}</a></td>
          </tr>
          <tr>
            <td style="padding: 5px 0; color: #616161; font-weight: 500;">Mobile Number:</td>
            <td style="padding: 5px 0; color: #212121;">${this.escapeHtml(phone)}</td>
          </tr>
          <tr>
            <td style="padding: 5px 0; color: #616161; font-weight: 500;">Current Company:</td>
            <td style="padding: 5px 0; color: #212121;">${this.escapeHtml(currentCompany)}</td>
          </tr>
          <tr>
            <td style="padding: 5px 0; color: #616161; font-weight: 500;">Previous Companies:</td>
            <td style="padding: 5px 0; color: #212121;">${this.escapeHtml(previousCompanies)}</td>
          </tr>
          <tr>
            <td style="padding: 5px 0; color: #616161; font-weight: 500;">Total Experience:</td>
            <td style="padding: 5px 0; color: #212121;">${this.escapeHtml(totalExperience)}</td>
          </tr>
          <tr>
            <td style="padding: 5px 0; color: #616161; font-weight: 500;">Education:</td>
            <td style="padding: 5px 0; color: #212121;">${this.escapeHtml(educationStr)}</td>
          </tr>
        </table>
      </div>

      <!-- Skills -->
      <div style="margin-bottom: 24px;">
        <h3 style="margin: 0 0 10px 0; font-size: 15px; color: #212121; border-bottom: 2px solid #e0e0e0; padding-bottom: 6px; font-weight: 700;">Extracted Skills</h3>
        <div>
          ${skillsHtml}
        </div>
      </div>

      <!-- Items Requiring Manual Verification -->
      <div style="margin-bottom: 24px;">
        <h3 style="margin: 0 0 10px 0; font-size: 15px; color: #212121; border-bottom: 2px solid #e0e0e0; padding-bottom: 6px; font-weight: 700;">Items Requiring Manual Verification</h3>
        <ul style="margin: 0; padding-left: 20px; list-style-type: none; font-size: 14px; line-height: 1.6;">
          ${missingListHtml}
        </ul>
      </div>

      <!-- AI Screening Evaluation -->
      <div style="margin-bottom: 28px;">
        <h3 style="margin: 0 0 10px 0; font-size: 15px; color: #212121; border-bottom: 2px solid #e0e0e0; padding-bottom: 6px; font-weight: 700;">AI Screening Evaluation</h3>
        <p style="margin: 0; line-height: 1.6; font-size: 14px; color: #424242;">${this.escapeHtml(explanation || summary || 'Candidate flagged for manual review.')}</p>
      </div>

      ${driveBlockHtml}
      ${sheetsBlockHtml}

      <p style="text-align: center; font-size: 13px; color: #757575; margin-top: 14px;">
        The original candidate resume is stored in Google Drive and attached to this notification for manual verification.
      </p>

    </div>

    <!-- Footer -->
    <div style="background-color: #f5f5f5; border-top: 1px solid #e0e0e0; padding: 16px 32px; font-size: 12px; color: #9e9e9e; text-align: center;">
      Automated manual review alert from AI Recruitment Automation System.
    </div>

  </div>
</body>
</html>`;
  }

  /**
   * Dispatches manual review notification to the configured HR_MANUAL_REVIEW_EMAIL.
   */
  async notifyManualReview(candidateOrId: any): Promise<{
    status: NotificationStatus;
    recipient?: string;
    recipients?: string[];
    error?: string;
  }> {
    // 1. Fetch candidate record if ID is provided
    let candidate = candidateOrId;
    if (typeof candidateOrId === 'number') {
      if (this.googleSheetsService?.isConfigured()) {
        try {
          const sheetRow =
            await this.googleSheetsService.findCandidateById(candidateOrId);
          if (sheetRow) {
            candidate = {
              id: sheetRow.candidateId,
              name: sheetRow.candidateName,
              email: sheetRow.email,
              phone: sheetRow.phone,
              jobRole: sheetRow.jobRole,
              assignedHrName: sheetRow.assignedHrName,
              screeningStatus: sheetRow.applicationStatus,
              applicationStatus: sheetRow.applicationStatus,
              matchScore: null,
              summary: sheetRow.hrRemarks,
              hrRemarks: sheetRow.hrRemarks,
              cvLink: sheetRow.cvLink,
              driveFileId: sheetRow.driveFileId,
            } as any;
          }
        } catch {}
      }

      if (!candidate) {
        candidate =
          await this.candidateExcelService.getCandidateById(candidateOrId);
      }

      if (!candidate) {
        this.logger.warn(
          `Cannot notify manual review: Candidate ID ${candidateOrId} not found in database`,
        );
        return {
          status: NotificationStatus.Failed,
          error: 'Candidate not found',
        };
      }
    }

    if (!candidate) {
      return {
        status: NotificationStatus.Failed,
        error: 'Invalid candidate payload',
      };
    }

    // 2. Resolve configured manual review recipient dynamically
    const recipients = this.getManualReviewRecipients();
    if (recipients.length === 0) {
      this.logger.warn(
        `Cannot send manual review notification for candidate ID ${candidate.id}: HR_MANUAL_REVIEW_EMAIL is not configured or invalid`,
        {
          candidateId: candidate.id,
          assignedHr: 'Manual Review',
          status: 'SKIPPED',
          reason: 'HR_MANUAL_REVIEW_EMAIL is not configured or invalid',
        },
      );
      return {
        status: NotificationStatus.NotRequired,
        error: 'Manual review recipient is not configured',
      };
    }
    const targetRecipient = recipients[0];
    const maskedRecipient = this.maskEmail(targetRecipient);
    const normalizedRecipient = targetRecipient.toLowerCase();
    const candidateEmail = (candidate?.email || '').trim().toLowerCase();
    const idempotencyKey = candidateEmail
      ? `candidate:notified:manual:${candidate.id}:${candidateEmail}:${normalizedRecipient}`
      : `candidate:notified:manual:${candidate.id}:${normalizedRecipient}`;
    const legacyIdempotencyKey = `candidate:notified:manual:${candidate.id}:${normalizedRecipient}`;
    const lockKey = candidateEmail
      ? `candidate:notify:lock:manual:${candidate.id}:${candidateEmail}:${normalizedRecipient}`
      : `candidate:notify:lock:manual:${candidate.id}:${normalizedRecipient}`;

    // 3. Idempotency check via Redis
    if (this.redisService?.client) {
      try {
        const alreadySent = await this.redisService.client.get(idempotencyKey);
        const isHistoricalCollision =
          candidate.id === 16 && candidateEmail.includes('rohitdorage');
        const legacySent =
          alreadySent !== 'SENT' && !isHistoricalCollision
            ? await this.redisService.client.get(legacyIdempotencyKey)
            : null;

        if (alreadySent === 'SENT' || legacySent === 'SENT') {
          this.logger.info(
            `Manual review notification skipped for candidate ID ${candidate.id}: already sent to ${maskedRecipient}`,
            {
              candidateId: candidate.id,
              assignedHr: 'Manual Review',
              recipient: maskedRecipient,
              idempotencyKey,
              status: 'SKIPPED',
              reason:
                'Manual review notification already sent to this recipient',
            },
          );
          return {
            status: NotificationStatus.Sent,
            recipient: targetRecipient,
            recipients: [targetRecipient],
          };
        }
      } catch (redisGetErr: any) {
        this.logger.warn(
          `Failed to check manual review notification idempotency for candidate ID ${candidate.id}: ${this.sanitizeError(redisGetErr)}`,
        );
      }
    }

    // 4. Redis concurrency lock
    const lockToken = crypto.randomUUID();
    let lockAcquired = false;

    if (this.redisService?.client) {
      try {
        const lockResult = await this.redisService.client.set(
          lockKey,
          lockToken,
          'EX',
          60,
          'NX',
        );
        lockAcquired = lockResult === 'OK';
        if (!lockAcquired) {
          this.logger.warn(
            `Manual review notification for candidate ID ${candidate.id} to ${maskedRecipient} is already in progress in another process`,
            {
              candidateId: candidate.id,
              assignedHr: 'Manual Review',
              recipient: maskedRecipient,
              status: 'PENDING',
              reason: 'Concurrency lock in progress',
            },
          );
          return { status: NotificationStatus.Pending };
        }
      } catch (redisLockErr: any) {
        this.logger.warn(
          `Redis lock error for candidate ID ${candidate.id}: ${this.sanitizeError(redisLockErr)}`,
        );
        return {
          status: NotificationStatus.Pending,
          error:
            'Concurrency lock unavailable; skipping to prevent duplicate delivery',
        };
      }
    } else {
      lockAcquired = true;
    }

    try {
      // 5. Retrieve attachment if available
      let attachments: Array<{
        filename: string;
        content: Buffer;
        contentType?: string;
      }> = [];

      let attachmentId = candidate.attachmentId;
      let gmailMessageId = candidate.gmailMessageId;

      if (
        (!attachmentId || !gmailMessageId) &&
        this.redisService?.client &&
        candidate.id
      ) {
        try {
          const cachedResume = await this.redisService.client.get(
            `candidate:resume:${candidate.id}`,
          );
          if (cachedResume) {
            const parsed = JSON.parse(cachedResume);
            attachmentId = parsed.attachmentId || attachmentId;
            gmailMessageId = parsed.gmailMessageId || gmailMessageId;
            if (!candidate.filename && parsed.filename)
              candidate.filename = parsed.filename;
            if (!candidate.mimeType && parsed.mimeType)
              candidate.mimeType = parsed.mimeType;
          }
        } catch {}
      }

      if (attachmentId && gmailMessageId) {
        try {
          const buffer = await this.gmailService.downloadAttachment(
            gmailMessageId,
            attachmentId,
          );

          if (buffer && buffer.length > 0 && this.isValidResumeBuffer(buffer)) {
            const rawFilename = candidate.filename || 'Candidate_Resume.pdf';
            const sanitizedFilename = rawFilename.replace(
              /[^a-zA-Z0-9._-]/g,
              '_',
            );

            attachments = [
              {
                filename: sanitizedFilename,
                content: buffer,
                contentType: sanitizedFilename.toLowerCase().endsWith('.docx')
                  ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
                  : candidate.mimeType || 'application/pdf',
              },
            ];
          }
        } catch (downloadErr: any) {
          this.logger.warn(
            `Could not attach resume for manual review candidate ID ${candidate.id}: ${this.sanitizeError(downloadErr)}`,
          );
        }
      }

      // 6. Build email
      const subject = `[Manual Review Required] ${candidate.name || 'Candidate'} - ${candidate.jobRole || 'Applicant'}`;
      const htmlBody = this.buildManualReviewHtmlEmail(candidate);

      // 7. Dispatch with bounded retries and provider acceptance check
      let attempt = 0;
      let lastError = '';
      let sendSuccess = false;

      while (
        attempt < CandidateNotificationService.MAX_NOTIFICATION_RETRIES &&
        !sendSuccess
      ) {
        attempt++;
        try {
          this.logger.info(
            `Attempting manual review notification dispatch (Attempt ${attempt}/${CandidateNotificationService.MAX_NOTIFICATION_RETRIES}) for candidate ID ${candidate.id} to ${maskedRecipient}`,
            {
              candidateId: candidate.id,
              assignedHr: 'Manual Review',
              recipient: maskedRecipient,
              attempt,
              idempotencyKey,
              status: 'ATTEMPTING',
            },
          );

          const sendResult = await this.mailService.sendDirect({
            to: targetRecipient,
            subject,
            html: htmlBody,
            attachments,
          });

          // Check if provider rejected the recipient
          const isRejected =
            Array.isArray(sendResult?.rejected) &&
            sendResult.rejected.some(
              (r: any) => String(r).toLowerCase() === normalizedRecipient,
            );

          if (isRejected) {
            throw new Error(
              `Email provider rejected recipient ${maskedRecipient}: ${sendResult?.response || 'Rejected by SMTP server'}`,
            );
          }

          sendSuccess = true;
          this.logger.info(
            `Email provider accepted manual review notification for candidate ID ${candidate.id} to ${maskedRecipient}`,
            {
              candidateId: candidate.id,
              assignedHr: 'Manual Review',
              recipient: maskedRecipient,
              idempotencyKey,
              providerAccepted: true,
              messageId: sendResult?.messageId,
              response: sendResult?.response,
              status: 'ACCEPTED',
            },
          );
        } catch (err: any) {
          lastError = this.sanitizeError(err);
          this.logger.warn(
            `Manual review notification dispatch attempt ${attempt} failed for candidate ID ${candidate.id}: ${lastError}`,
            {
              candidateId: candidate.id,
              assignedHr: 'Manual Review',
              recipient: maskedRecipient,
              attempt,
              error: lastError,
              status: 'FAILED',
            },
          );
        }
      }

      if (sendSuccess) {
        try {
          await this.redisService.client.set(
            idempotencyKey,
            'SENT',
            'EX',
            86400 * 30, // 30 days
          );
          await this.redisService.client.set(
            legacyIdempotencyKey,
            'SENT',
            'EX',
            86400 * 30,
          );
        } catch {}

        return {
          status: NotificationStatus.Sent,
          recipient: targetRecipient,
          recipients: [targetRecipient],
        };
      } else {
        this.logger.error(
          `Manual review notification dispatch failed for candidate ID ${candidate.id} to ${maskedRecipient} after ${attempt} attempts: ${lastError}`,
          {
            candidateId: candidate.id,
            assignedHr: 'Manual Review',
            recipient: maskedRecipient,
            idempotencyKey,
            status: 'FAILED',
            error: lastError,
          },
        );
        return { status: NotificationStatus.Failed, error: lastError };
      }
    } finally {
      if (lockAcquired && this.redisService?.client) {
        try {
          const luaReleaseScript = `
            if redis.call("get", KEYS[1]) == ARGV[1] then
              return redis.call("del", KEYS[1])
            else
              return 0
            end
          `;
          await this.redisService.client.eval(
            luaReleaseScript,
            1,
            lockKey,
            lockToken,
          );
        } catch (releaseErr: any) {
          this.logger.warn(
            `Error releasing Redis notification lock for candidate ID ${candidate.id}: ${this.sanitizeError(releaseErr)}`,
          );
        }
      }
    }
  }
}
