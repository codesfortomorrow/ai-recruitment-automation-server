import { Injectable } from '@nestjs/common';
import { BaseService } from '@Common';
import {
  findJobRoleByAlias,
  JobRoleDefinition,
} from '../configs/job-roles.config';
import { CanonicalRole } from '../candidate/candidate.types';

export interface RoleDetectionInput {
  subject?: string | null;
  emailBody?: string | null;
  sender?: { email?: string; name?: string } | null;
  metadataRole?: string | null;
  trustedRole?: string | null;
}

export type RoleResolutionStatus = 'RESOLVED' | 'CONFLICT' | 'UNRESOLVED';

export interface RoleResolutionResult {
  status: RoleResolutionStatus;
  role: JobRoleDefinition | null;
  canonicalRole: CanonicalRole | null;
  appliedRole: string;
  rawRoleDetected?: string | null;
  source?: 'EXPLICIT' | 'SUBJECT' | 'BODY' | 'METADATA';
  confidence?: 'HIGH' | 'MEDIUM';
  reason?: string;
  explanation?: string;
}

@Injectable()
export class RoleDetectionService extends BaseService {
  constructor() {
    super({
      loggerDefaultMeta: { service: RoleDetectionService.name },
    });
  }

  /**
   * Cleans and normalizes raw text for role pattern extraction.
   */
  private normalizeText(text?: string | null): string {
    if (!text) return '';
    return text
      .toLowerCase()
      .replace(/[\-_/\\,()\[\]{}|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Extracts a potential role string from explicit application intent patterns
   * in email text (e.g., "application for ...", "applying for ...", "role of ...").
   */
  public extractRoleIntent(text?: string | null): string | null {
    if (!text) return null;

    const patterns = [
      /(?:apply(?:ing)?\s+for|application\s+(?:for|to)|position\s+(?:of|for)|role\s+(?:of|for|:)|job\s+(?:application|role|opening|title)\s*(?:for|:|-)?|post\s+of)\s+([a-zA-Z0-9\.\s/+#-]+?)(?:\s*[-–|–\(\[]|\s+at|\s+with|\s+in|\.|\r|\n|$)/i,
      /(?:interested\s+in\s+(?:the\s+)?(?:position|role|opening|job)?\s*(?:of|for)?)\s+([a-zA-Z0-9\.\s/+#-]+?)(?:\s*[-–|–\(\[]|\s+at|\s+with|\s+in|\.|\r|\n|$)/i,
      /(?:profile\s*(?:applied|for|:))\s*([a-zA-Z0-9\.\s/+#-]+?)(?:\s*[-–|–\(\[]|\s+at|\s+with|\s+in|\.|\r|\n|$)/i,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        const candidate = match[1].trim();
        // Discard generic non-roles like "a job", "the company", etc.
        if (
          candidate.length > 2 &&
          candidate.length < 50 &&
          !/^(a\s+job|an\s+opportunity|your\s+company|the\s+position|employment)$/i.test(
            candidate,
          )
        ) {
          return candidate;
        }
      }
    }

    return null;
  }

  /**
   * Matches candidate text against configured job roles and their aliases.
   */
  public matchConfiguredRole(text?: string | null): JobRoleDefinition | null {
    if (!text) return null;
    return findJobRoleByAlias(text);
  }

  /**
   * Resolves the applied role using strict priority order:
   * 1. Explicit, trusted role linked to application or job opening.
   * 2. Clearly stated role in email subject or body (with conflict detection).
   * 3. Existing application metadata or configured vacancy.
   *
   * If subject and body conflict, flags conflict for manual review.
   * If no reliable role can be identified, sets UNRESOLVED without defaulting to HR Intern.
   */
  public resolveRole(input: RoleDetectionInput): RoleResolutionResult {
    const { subject, emailBody, metadataRole, trustedRole } = input;

    // 1. Priority 1: Explicit, trusted role
    if (trustedRole) {
      const matched = this.matchConfiguredRole(trustedRole);
      if (matched) {
        return {
          status: 'RESOLVED',
          role: matched,
          canonicalRole: matched.canonicalRole,
          appliedRole: matched.title,
          rawRoleDetected: trustedRole,
          source: 'EXPLICIT',
          confidence: 'HIGH',
        };
      }
    }

    // 2. Priority 2: Email Subject & Body Inspection
    // A. Subject Check
    let subjectRole: JobRoleDefinition | null = null;
    let subjectRaw: string | null = null;
    if (subject) {
      const intentRole = this.extractRoleIntent(subject);
      if (intentRole) {
        subjectRole = this.matchConfiguredRole(intentRole);
        subjectRaw = intentRole;
      }
      if (!subjectRole) {
        subjectRole = this.matchConfiguredRole(subject);
        subjectRaw = subjectRole?.title || subject;
      }
    }

    // B. Body Check
    let bodyRole: JobRoleDefinition | null = null;
    let bodyRaw: string | null = null;
    if (emailBody) {
      const intentRole = this.extractRoleIntent(emailBody);
      if (intentRole) {
        bodyRole = this.matchConfiguredRole(intentRole);
        bodyRaw = intentRole;
      }
      if (!bodyRole) {
        // Inspect initial 500 characters of body for explicit role mention
        const snippet = emailBody.slice(0, 500);
        bodyRole = this.matchConfiguredRole(snippet);
        bodyRaw = bodyRole?.title || null;
      }
    }

    // C. Conflict Detection between Subject and Body
    if (subjectRole && bodyRole) {
      if (subjectRole.canonicalRole !== bodyRole.canonicalRole) {
        this.logger.warn(
          `Conflicting roles detected: Subject="${subjectRole.title}" vs Body="${bodyRole.title}"`,
          {
            subjectRole: subjectRole.canonicalRole,
            bodyRole: bodyRole.canonicalRole,
          },
        );

        return {
          status: 'CONFLICT',
          role: null,
          canonicalRole: null,
          appliedRole: `Conflict: ${subjectRole.title} / ${bodyRole.title}`,
          rawRoleDetected: `Subject: "${subjectRaw}", Body: "${bodyRaw}"`,
          reason: 'ROLE_CONFLICT',
          explanation: `ROLE_CONFLICT: Conflicting roles detected between email subject ("${subjectRole.title}") and email body ("${bodyRole.title}"). Routed to manual HR review.`,
        };
      }

      // Both match the same canonical role
      return {
        status: 'RESOLVED',
        role: subjectRole,
        canonicalRole: subjectRole.canonicalRole,
        appliedRole: subjectRole.title,
        rawRoleDetected: subjectRaw || bodyRaw,
        source: 'SUBJECT',
        confidence: 'HIGH',
      };
    }

    // If only Subject matched
    if (subjectRole) {
      return {
        status: 'RESOLVED',
        role: subjectRole,
        canonicalRole: subjectRole.canonicalRole,
        appliedRole: subjectRole.title,
        rawRoleDetected: subjectRaw,
        source: 'SUBJECT',
        confidence: 'HIGH',
      };
    }

    // If only Body matched
    if (bodyRole) {
      return {
        status: 'RESOLVED',
        role: bodyRole,
        canonicalRole: bodyRole.canonicalRole,
        appliedRole: bodyRole.title,
        rawRoleDetected: bodyRaw,
        source: 'BODY',
        confidence: 'HIGH',
      };
    }

    // 3. Priority 3: Application metadata / configured vacancy
    if (metadataRole) {
      const matched = this.matchConfiguredRole(metadataRole);
      if (matched) {
        return {
          status: 'RESOLVED',
          role: matched,
          canonicalRole: matched.canonicalRole,
          appliedRole: matched.title,
          rawRoleDetected: metadataRole,
          source: 'METADATA',
          confidence: 'MEDIUM',
        };
      }
    }

    // 4. No reliable role could be identified from email context
    this.logger.info(
      'No supported job role identified from email context; routing to manual review without defaulting to HR Intern',
      { subject: subject?.slice(0, 100) },
    );

    return {
      status: 'UNRESOLVED',
      role: null,
      canonicalRole: null,
      appliedRole: 'Undetected Role',
      rawRoleDetected: null,
      reason: 'ROLE_UNDETECTED',
      explanation:
        'ROLE_UNDETECTED: No supported job role could be identified from email subject, body, or application metadata. Routed to manual HR review.',
    };
  }

  /**
   * Helper method that accepts email context and returns the resolved role result.
   */
  public detectRole(input: {
    subject?: string | null;
    body?: string | null;
    senderName?: string | null;
    senderEmail?: string | null;
    metadataRole?: string | null;
    trustedRole?: string | null;
  }): RoleResolutionResult & { detectedRole?: string } {
    const resolution = this.resolveRole({
      subject: input.subject,
      emailBody: input.body,
      sender: {
        name: input.senderName || undefined,
        email: input.senderEmail || undefined,
      },
      metadataRole: input.metadataRole,
      trustedRole: input.trustedRole,
    });

    return {
      ...resolution,
      detectedRole:
        resolution.role?.title ||
        (resolution.status === 'RESOLVED' ? resolution.appliedRole : undefined),
    };
  }
}
