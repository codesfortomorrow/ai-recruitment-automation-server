export type ScreeningStatus = 'SHORTLIST' | 'REJECT' | 'MANUAL_REVIEW';

export type ExperienceCategory =
  | 'Fresher / no professional experience'
  | 'Relevant HR or recruitment internship'
  | 'Relevant recruitment work experience'
  | 'Other or unrelated experience'
  | 'Unclear / insufficient information';

export type SuggestedProfile =
  | 'HR Intern'
  | 'HR Associate / HR Executive'
  | (string & {});

export type RecommendedStatus =
  | 'Shortlist'
  | 'HR Review'
  | 'Not Shortlisted'
  | 'Requires Human Review';

export interface ScoreEvidenceDetails {
  recruitmentAndTalentAcquisition?: number; // max 30
  practicalInternshipOrWork?: number; // max 20
  screeningSchedulingAndFollowups?: number; // max 15
  sourcingChannels?: number; // max 10
  communicationAndCoordination?: number; // max 10
  excelOrGoogleSheets?: number; // max 10
  otherHrOperations?: number; // max 5
  evidenceNotes?: string;
  [key: string]: any;
}

export interface CandidateInfo {
  name: string | null;
  email: string | null;
  phone: string | null;
}

export interface EducationEntry {
  institution?: string | null;
  degree?: string | null;
  fieldOfStudy?: string | null;
  year?: string | null;
}

export interface ExperienceEntry {
  company?: string | null;
  role?: string | null;
  duration?: string | null;
  description?: string | null;
}

export interface ProjectEntry {
  name?: string | null;
  description?: string | null;
  technologies?: string[];
}

export interface ApplicationInfo {
  jobRole: string | null;
  skills: string[];
  projects: (ProjectEntry | string)[];
  education: (EducationEntry | string)[];
  experience: (ExperienceEntry | string)[];
}

export interface CandidateApplicationAnalysis {
  candidate: CandidateInfo;
  application: ApplicationInfo;
  summary: string;
  matchScore: number | null; // 0 to 100, or null if resume extraction was insufficient or role unresolved
  matchedRequirements: string[];
  missingOrUnclearRequirements: string[];
  screeningStatus: ScreeningStatus;
  screeningExplanation: string;
  hrReviewRequired: boolean;
  rejectionReason?: string | null;

  // Role tracking
  appliedRole?: string;
  resolvedRole?: string;
  suggestedAlternativeRole?: string;

  // Structured fields for Codes for Tomorrow HR Screening
  experienceCategory: ExperienceCategory;
  relevantExperienceResponsibilities: string[];
  scoreEvidence: ScoreEvidenceDetails;
  missingOrUnclearInformation: string[];
  strengthsAgainstJd: string[];
  gapsAgainstJd: string[];
  suggestedProfile: SuggestedProfile;
  recommendedStatus: RecommendedStatus;

  // Backwards-compatible aliases
  missingInformation?: string[];
  warnings?: string[];
}

export type GeminiApplicationAnalysis = CandidateApplicationAnalysis;

export type AnalysisStatus = 'success' | 'failed' | 'skipped';

export interface ResumeAnalysisResult {
  attachmentId?: string;
  filename?: string;
  status: AnalysisStatus;
  analysis?: CandidateApplicationAnalysis;
  error?: string;
  analyzedAt: string;
  model: string;
  fingerprint?: string;
  lockToken?: string;
  isTransient?: boolean;
  isPermanent?: boolean;
  httpStatus?: number;
  retryAfterMs?: number;
}

export type ScreeningJobStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'RETRY_WAIT'
  | 'SHEETS_SAVED'
  | 'NOTIFICATION_PENDING'
  | 'COMPLETED'
  | 'MANUAL_REVIEW'
  | 'FAILED_RETRYABLE'
  | 'FAILED_PERMANENT'
  | 'FAILED_PERMANENTLY';

export interface ScreeningJob {
  id: string; // resume SHA-256 fingerprint
  fingerprint: string;
  messageId: string;
  attachmentId: string;
  filename: string;
  mimeType?: string;
  fileSize?: number;
  sender: {
    email: string;
    name?: string;
  };
  subject: string;
  receivedDate?: string;
  emailBody?: string;
  extractedResumeText: string;
  status: ScreeningJobStatus;
  attemptCount: number;
  maxAttempts: number;
  nextRetryAt: number; // unix timestamp ms
  createdAt: string;
  updatedAt: string;
  lastError?: string;
  lastHttpStatus?: number;
  completedAt?: string;
  candidateId?: number;
  jobRole?: string;
  driveFileId?: string;
  cvLink?: string;
  source?: 'GMAIL' | 'DRIVE_MANUAL';
}

export interface AnalyzeApplicationInput {
  messageId: string;
  subject: string;
  sender: {
    email: string;
    name?: string;
  };
  recipient?: string;
  receivedDate?: Date | string;
  emailBody?: string;
  resumeText?: string;
  filename?: string;
  attachmentId?: string;
  jobRole?: string;
  jobDescription?: string;
  mandatoryCriteria?: string[];
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  analysis?: CandidateApplicationAnalysis;
}

/**
 * Validates the raw JSON output returned by Google Gemini or the screening engine
 * to ensure compliance with the Codes for Tomorrow recruitment screening schema.
 */
export function validateApplicationAnalysis(data: any): ValidationResult {
  const errors: string[] = [];

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return {
      valid: false,
      errors: ['Analysis response must be a non-null JSON object'],
    };
  }

  // 1. Candidate
  if (!data.candidate || typeof data.candidate !== 'object') {
    errors.push('Missing or invalid "candidate" property');
  } else {
    if (
      data.candidate.name !== null &&
      data.candidate.name !== undefined &&
      typeof data.candidate.name !== 'string'
    ) {
      errors.push('candidate.name must be a string or null');
    }
    if (
      data.candidate.email !== null &&
      data.candidate.email !== undefined &&
      typeof data.candidate.email !== 'string'
    ) {
      errors.push('candidate.email must be a string or null');
    }
    if (
      data.candidate.phone !== null &&
      data.candidate.phone !== undefined &&
      typeof data.candidate.phone !== 'string'
    ) {
      errors.push('candidate.phone must be a string or null');
    }
  }

  // 2. Application
  if (!data.application || typeof data.application !== 'object') {
    errors.push('Missing or invalid "application" property');
  } else {
    if (
      data.application.jobRole !== null &&
      data.application.jobRole !== undefined &&
      typeof data.application.jobRole !== 'string'
    ) {
      errors.push('application.jobRole must be a string or null');
    }
    if (!Array.isArray(data.application.skills)) {
      errors.push('application.skills must be an array of strings');
    }
    if (!Array.isArray(data.application.projects)) {
      errors.push('application.projects must be an array');
    }
    if (!Array.isArray(data.application.education)) {
      errors.push('application.education must be an array');
    }
    if (!Array.isArray(data.application.experience)) {
      errors.push('application.experience must be an array');
    }
  }

  // 3. Summary
  if (typeof data.summary !== 'string' || data.summary.trim().length === 0) {
    errors.push('Missing or invalid "summary" property (must be a string)');
  }

  // 4. Match Score (0 to 100, or null)
  if (
    data.matchScore !== null &&
    data.matchScore !== undefined &&
    (typeof data.matchScore !== 'number' ||
      isNaN(data.matchScore) ||
      data.matchScore < 0 ||
      data.matchScore > 100)
  ) {
    errors.push(
      'Missing or invalid "matchScore" property (must be a number between 0 and 100, or null)',
    );
  } else if (data.matchScore === undefined) {
    errors.push(
      'Missing or invalid "matchScore" property (must be a number between 0 and 100, or null)',
    );
  }

  // 5. Requirements Arrays
  if (!Array.isArray(data.matchedRequirements)) {
    errors.push(
      'Missing or invalid "matchedRequirements" property (must be an array of strings)',
    );
  }
  if (!Array.isArray(data.missingOrUnclearRequirements)) {
    errors.push(
      'Missing or invalid "missingOrUnclearRequirements" property (must be an array of strings)',
    );
  }

  // 6. Screening Explanation
  if (
    typeof data.screeningExplanation !== 'string' ||
    data.screeningExplanation.trim().length === 0
  ) {
    errors.push(
      'Missing or invalid "screeningExplanation" property (must be a non-empty string)',
    );
  }

  if (errors.length > 0) {
    return {
      valid: false,
      errors,
    };
  }

  // Derive / normalize score evidence breakdown
  const rawScoreEvidence = data.scoreEvidence || {};
  const scoreEvidence: ScoreEvidenceDetails = {
    recruitmentAndTalentAcquisition: Math.min(
      30,
      Math.max(
        0,
        Number(rawScoreEvidence.recruitmentAndTalentAcquisition) || 0,
      ),
    ),
    practicalInternshipOrWork: Math.min(
      20,
      Math.max(0, Number(rawScoreEvidence.practicalInternshipOrWork) || 0),
    ),
    screeningSchedulingAndFollowups: Math.min(
      15,
      Math.max(
        0,
        Number(rawScoreEvidence.screeningSchedulingAndFollowups) || 0,
      ),
    ),
    sourcingChannels: Math.min(
      10,
      Math.max(0, Number(rawScoreEvidence.sourcingChannels) || 0),
    ),
    communicationAndCoordination: Math.min(
      10,
      Math.max(0, Number(rawScoreEvidence.communicationAndCoordination) || 0),
    ),
    excelOrGoogleSheets: Math.min(
      10,
      Math.max(0, Number(rawScoreEvidence.excelOrGoogleSheets) || 0),
    ),
    otherHrOperations: Math.min(
      5,
      Math.max(0, Number(rawScoreEvidence.otherHrOperations) || 0),
    ),
    evidenceNotes: rawScoreEvidence.evidenceNotes
      ? String(rawScoreEvidence.evidenceNotes)
      : undefined,
  };

  // If matchScore is given but breakdown was not populated, approximate breakdown proportionally
  const breakdownSum =
    (scoreEvidence.recruitmentAndTalentAcquisition || 0) +
    (scoreEvidence.practicalInternshipOrWork || 0) +
    (scoreEvidence.screeningSchedulingAndFollowups || 0) +
    (scoreEvidence.sourcingChannels || 0) +
    (scoreEvidence.communicationAndCoordination || 0) +
    (scoreEvidence.excelOrGoogleSheets || 0) +
    (scoreEvidence.otherHrOperations || 0);

  let calculatedScore: number | null = null;
  if (data.matchScore !== null && data.matchScore !== undefined) {
    calculatedScore = Math.round(Number(data.matchScore));
    if (breakdownSum > 0 && Math.abs(breakdownSum - calculatedScore) > 10) {
      calculatedScore = Math.min(100, Math.max(0, breakdownSum));
    }
  }

  // Classify experience category
  const validExpCategories: ExperienceCategory[] = [
    'Fresher / no professional experience',
    'Relevant HR or recruitment internship',
    'Relevant recruitment work experience',
    'Other or unrelated experience',
    'Unclear / insufficient information',
  ];
  let experienceCategory: ExperienceCategory = data.experienceCategory;
  if (!validExpCategories.includes(experienceCategory)) {
    const experiences: any[] = data.application?.experience || [];
    if (experiences.length === 0) {
      experienceCategory = 'Fresher / no professional experience';
    } else {
      const expText = JSON.stringify(experiences).toLowerCase();
      const hasHrKeywords =
        expText.includes('recruitment') ||
        expText.includes('talent acquisition') ||
        expText.includes('sourcing') ||
        expText.includes('hr intern') ||
        expText.includes('human resources');
      const isIntern =
        expText.includes('intern') || expText.includes('trainee');

      if (hasHrKeywords && isIntern) {
        experienceCategory = 'Relevant HR or recruitment internship';
      } else if (hasHrKeywords) {
        experienceCategory = 'Relevant recruitment work experience';
      } else {
        experienceCategory = 'Other or unrelated experience';
      }
    }
  }

  // Suggested profile resolution: prioritize canonical/resolved role and prevent narrative sentences
  let suggestedProfile: SuggestedProfile =
    data.resolvedRole || data.application?.jobRole || data.suggestedProfile;
  if (
    !suggestedProfile ||
    (typeof suggestedProfile === 'string' && suggestedProfile.length > 50)
  ) {
    if (data.resolvedRole || data.application?.jobRole) {
      suggestedProfile = (data.resolvedRole ||
        data.application?.jobRole) as SuggestedProfile;
    } else if (
      experienceCategory === 'Relevant recruitment work experience' &&
      calculatedScore !== null &&
      calculatedScore >= 60
    ) {
      suggestedProfile = 'HR Associate / HR Executive';
    } else {
      suggestedProfile = 'HR Intern';
    }
  }

  // Business Rules for Initial Routing Thresholds:
  // 60–100: Shortlist for HR consideration (unless manual review is explicitly flagged for uncertain role/evidence)
  // 40–59: HR Review
  // Below 40: HR Review before rejection
  // Null score: Requires Human Review / Manual Review
  // CORE RULE: A low score alone must NEVER automatically reject a candidate.
  // Freshers and candidates with 0–2 years of experience are eligible.
  let recommendedStatus: RecommendedStatus;
  let screeningStatus: ScreeningStatus;
  let hrReviewRequired: boolean;

  if (calculatedScore === null) {
    recommendedStatus = 'Requires Human Review';
    screeningStatus = 'MANUAL_REVIEW';
    hrReviewRequired = true;
  } else if (
    data.hrReviewRequired ||
    data.screeningStatus === 'MANUAL_REVIEW' ||
    data.recommendedStatus === 'Requires Human Review' ||
    data.recommendedStatus === 'HR Review'
  ) {
    // Preserve manual review requirement when explicitly indicated or role/evidence is uncertain
    recommendedStatus = 'HR Review';
    screeningStatus = 'MANUAL_REVIEW';
    hrReviewRequired = true;
  } else if (calculatedScore >= 60) {
    recommendedStatus = 'Shortlist';
    screeningStatus = 'SHORTLIST';
    hrReviewRequired = false;
  } else if (calculatedScore >= 40) {
    recommendedStatus = 'HR Review';
    screeningStatus = 'MANUAL_REVIEW';
    hrReviewRequired = true;
  } else {
    // Below 40: HR Review before rejection
    recommendedStatus = 'Not Shortlisted';
    screeningStatus = 'MANUAL_REVIEW'; // Never automatically REJECT on score alone!
    hrReviewRequired = true;
  }

  // Missing or unclear info
  const missingOrUnclearInfo = Array.isArray(data.missingOrUnclearInformation)
    ? data.missingOrUnclearInformation.map(String)
    : Array.isArray(data.missingOrUnclearRequirements)
      ? data.missingOrUnclearRequirements.map(String)
      : [];

  const strengths = Array.isArray(data.strengthsAgainstJd)
    ? data.strengthsAgainstJd.map(String)
    : (data.matchedRequirements || []).map(String);

  const gaps = Array.isArray(data.gapsAgainstJd)
    ? data.gapsAgainstJd.map(String)
    : (data.missingOrUnclearRequirements || []).map(String);

  const relevantResponsibilities = Array.isArray(
    data.relevantExperienceResponsibilities,
  )
    ? data.relevantExperienceResponsibilities.map(String)
    : [];

  const normalizedAnalysis: CandidateApplicationAnalysis = {
    candidate: {
      name: data.candidate.name ?? null,
      email: data.candidate.email ?? null,
      phone: data.candidate.phone ?? null,
    },
    application: {
      jobRole: data.application.jobRole ?? null,
      skills: (data.application.skills || []).map(String),
      projects: data.application.projects || [],
      education: data.application.education || [],
      experience: data.application.experience || [],
    },
    summary: String(data.summary).trim(),
    matchScore: calculatedScore,
    matchedRequirements: (data.matchedRequirements || []).map(String),
    missingOrUnclearRequirements: (data.missingOrUnclearRequirements || []).map(
      String,
    ),
    screeningStatus,
    screeningExplanation: String(data.screeningExplanation).trim(),
    hrReviewRequired,
    rejectionReason:
      data.rejectionReason !== undefined ? data.rejectionReason : null,

    // Role tracking
    appliedRole: data.appliedRole ? String(data.appliedRole) : undefined,
    resolvedRole: data.resolvedRole ? String(data.resolvedRole) : undefined,
    suggestedAlternativeRole: data.suggestedAlternativeRole
      ? String(data.suggestedAlternativeRole)
      : undefined,

    // Enhanced Codes for Tomorrow fields
    experienceCategory,
    relevantExperienceResponsibilities: relevantResponsibilities,
    scoreEvidence,
    missingOrUnclearInformation: missingOrUnclearInfo,
    strengthsAgainstJd: strengths,
    gapsAgainstJd: gaps,
    suggestedProfile,
    recommendedStatus,

    missingInformation: missingOrUnclearInfo,
    warnings: Array.isArray(data.warnings)
      ? data.warnings.map(String)
      : undefined,
  };

  return {
    valid: true,
    errors: [],
    analysis: normalizedAnalysis,
  };
}

export const validateGeminiAnalysis = validateApplicationAnalysis;
