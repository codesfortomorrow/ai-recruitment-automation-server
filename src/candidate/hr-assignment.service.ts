import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { hrConfigFactory } from '@Config';
import { AssignedHrResult, CanonicalRole } from './candidate.types';
import {
  findJobRoleByAlias,
  getJobRoleByCanonical,
  JobRoleDefinition,
} from '../configs/job-roles.config';

export interface HrAssignmentContext {
  matchScore?: number | null;
  screeningStatus?: string | null;
  hrReviewRequired?: boolean | null;
  missingRequirements?: string[] | null;
}

@Injectable()
export class HrAssignmentService {
  constructor(
    @Inject(hrConfigFactory.KEY)
    private readonly hrConfig: ConfigType<typeof hrConfigFactory>,
  ) {}

  /**
   * Normalizes a job role string by trimming, lowercasing, and normalizing punctuation.
   */
  normalizeJobRole(rawRole: string | null | undefined): string {
    if (!rawRole) return '';
    return rawRole
      .toLowerCase()
      .replace(/[\-_/\\,()\[\]{}|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Determines whether a given job role qualifies for recruitment/HR functions.
   */
  isRecruitmentRole(rawRole: string | null | undefined): boolean {
    if (!rawRole) return false;
    const matchedRole = findJobRoleByAlias(rawRole);
    if (matchedRole && matchedRole.assignedHrTeam === 'RECRUITMENT') {
      return true;
    }

    const normalized = this.normalizeJobRole(rawRole);
    if (!normalized) return false;

    return (
      /\b(hr|human resources|recruitment|recruiter|talent acquisition)\b/.test(
        normalized,
      ) && !/\b(developer|engineer|tester|designer|analyst)\b/.test(normalized)
    );
  }

  /**
   * Determines the canonical role and assigned HR for an applied job role.
   * If candidate role qualifies for recruitment:
   *  - Candidates scoring 60 or above who qualify for shortlist are assigned to HR2 (Jayendra).
   *  - Candidates requiring genuine human review or scoring below 60 remain assigned to Manual Review.
   * For non-recruitment roles:
   *  - Software Development & Design roles -> HR1 (Abhishek)
   *  - QA, Business Analyst, Marketing roles -> HR2 (Jayendra)
   * Returns null if the role is unknown, unsupported, or ambiguous across HRs.
   */
  assignHr(
    rawRole: string | null | undefined,
    contextOrScore?: HrAssignmentContext | number | null,
    explicitStatus?: string | null,
  ): AssignedHrResult | null {
    if (!rawRole) {
      return null;
    }

    const normalized = this.normalizeJobRole(rawRole);
    if (!normalized) {
      return null;
    }

    let matchScore: number | undefined;
    let screeningStatus: string | undefined;
    let hrReviewRequired = false;

    if (typeof contextOrScore === 'number') {
      matchScore = contextOrScore;
      screeningStatus = explicitStatus?.trim() || undefined;
    } else if (contextOrScore && typeof contextOrScore === 'object') {
      matchScore =
        typeof contextOrScore.matchScore === 'number'
          ? contextOrScore.matchScore
          : undefined;
      screeningStatus = contextOrScore.screeningStatus?.trim() || undefined;
      hrReviewRequired = Boolean(contextOrScore.hrReviewRequired);
    }

    // Check for explicit cross-team conflicts (e.g. "React and QA" or "Conflict: MERN / QA")
    if (/\bconflict\b/i.test(normalized)) {
      return null;
    }

    let matchedRole: JobRoleDefinition | null = findJobRoleByAlias(rawRole);
    if (!matchedRole && this.isRecruitmentRole(rawRole)) {
      const isIntern = /\b(intern|trainee|internship)\b/i.test(normalized);
      matchedRole = getJobRoleByCanonical(
        isIntern ? 'HR_INTERN' : 'HR_EXECUTIVE',
      );
    }
    if (!matchedRole) {
      return null;
    }

    // Check if the raw string also strongly indicates another conflicting HR team
    if (matchedRole.assignedHrTeam === 'HR1') {
      // If it also explicitly mentions QA, BA, or HR
      if (
        /\b(qa\b|quality assurance|software tester|business analyst|hr intern|human resources|recruitment)\b/i.test(
          normalized,
        )
      ) {
        return null;
      }
    } else if (matchedRole.assignedHrTeam === 'HR2') {
      // If it also explicitly mentions frontend/react/node/mern developer or HR recruitment
      if (
        /\b(react\b|node\b|mern\b|full\s*stack|hr intern|human resources|talent acquisition)\b/i.test(
          normalized,
        )
      ) {
        return null;
      }
    }

    // 1. Recruitment role assignment
    if (matchedRole.assignedHrTeam === 'RECRUITMENT') {
      const canonicalRole: CanonicalRole = matchedRole.canonicalRole;

      const isEligibleScore =
        typeof matchScore === 'number' && matchScore >= 60;
      const isShortlisted =
        screeningStatus === 'SHORTLIST' ||
        (isEligibleScore &&
          screeningStatus !== 'MANUAL_REVIEW' &&
          screeningStatus !== 'REJECT' &&
          !hrReviewRequired);

      // Candidates scoring 60 or above who qualify for shortlist are assigned to Jayendra (HR2)
      if (isEligibleScore && isShortlisted) {
        return {
          id: this.hrConfig.hr2.id.trim(),
          name: this.hrConfig.hr2.name.trim(),
          email: this.hrConfig.hr2.email.trim(),
          canonicalRole,
        };
      }

      // Candidate does not meet shortlist threshold (< 60) or requires genuine human review
      const manualHr = this.getManualReviewHr();
      return {
        id: manualHr.id,
        name: manualHr.name,
        email: manualHr.email || this.hrConfig.hr2?.email || '',
        canonicalRole,
      };
    }

    // 2. HR1: Software Development & Design roles
    if (matchedRole.assignedHrTeam === 'HR1') {
      return {
        id: this.hrConfig.hr1.id.trim(),
        name: this.hrConfig.hr1.name.trim(),
        email: this.hrConfig.hr1.email.trim(),
        canonicalRole: matchedRole.canonicalRole,
      };
    }

    // 3. HR2: QA, BA, and Marketing roles
    if (matchedRole.assignedHrTeam === 'HR2') {
      return {
        id: this.hrConfig.hr2.id.trim(),
        name: this.hrConfig.hr2.name.trim(),
        email: this.hrConfig.hr2.email.trim(),
        canonicalRole: matchedRole.canonicalRole,
      };
    }

    return null;
  }

  /**
   * Returns the designated manual review recipient configuration.
   */
  getManualReviewHr(): { id: string; name: string; email: string } {
    return {
      id: 'hr-manual-review',
      name: 'Manual Review',
      email: (this.hrConfig.manualReviewEmail || '').trim(),
    };
  }
}
