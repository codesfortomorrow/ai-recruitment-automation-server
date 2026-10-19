import { ExcelSyncStatus, ExcelSyncTrigger } from '../generated/prisma/client';

export type CanonicalRole =
  // Software development
  | 'MERN_DEVELOPER'
  | 'FULL_STACK_DEVELOPER'
  | 'REACT_DEVELOPER'
  | 'NODE_DEVELOPER'
  | 'SOFTWARE_DEVELOPER'
  | 'FRONTEND_DEVELOPER'
  | 'BACKEND_DEVELOPER'
  | 'JAVASCRIPT_DEVELOPER'
  | 'TYPESCRIPT_DEVELOPER'
  | 'JAVA_DEVELOPER'
  | 'PYTHON_DEVELOPER'

  // QA and testing
  | 'QA_TESTER'
  | 'QA_AUTOMATION_ENGINEER'
  | 'MANUAL_TESTER'

  // Business and HR
  | 'BUSINESS_ANALYST'
  | 'HR_INTERN'
  | 'HR_EXECUTIVE'
  | 'RECRUITER'
  | 'TALENT_ACQUISITION'

  // Marketing
  | 'DIGITAL_MARKETER'
  | 'DIGITAL_MARKETING_EXECUTIVE'
  | 'SEO_SPECIALIST'
  | 'SOCIAL_MEDIA_MANAGER'
  | 'CONTENT_MARKETER'
  | 'PERFORMANCE_MARKETER'

  // Creative and design
  | 'VIDEO_EDITOR'
  | 'MOTION_GRAPHICS_DESIGNER'
  | 'GRAPHIC_DESIGNER'
  | 'UI_UX_DESIGNER'
  | 'UI_DESIGNER'
  | 'UX_DESIGNER';

export interface AssignedHrResult {
  id: string;
  name: string;
  email: string;
  canonicalRole: CanonicalRole;
}

export interface CandidateStatsResponse {
  total: number;
  shortlisted: number;
  rejected: number;
  manualReview: number;
  totalCandidates?: number;
  pending?: number;
  assignedToHr1?: number;
  assignedToHr2?: number;
  unassigned?: number;
  roleBreakdown?: Array<{ role: string; count: number }>;
}

export interface CandidateProfileResponse {
  id: number;
  name: string | null;
  email: string | null;
  phone: string | null;
  jobRole: string | null;
  normalizedRole: string | null;
  skills: string[];
  education: any[];
  experience: any[];
  projects: any[];
  summary: string;
  matchScore: number | null;
  matchedRequirements: string[];
  missingRequirements: string[];
  screeningStatus: string;
  screeningExplanation: string;
  rejectionReason: string | null;
  assignedHrId: string | null;
  assignedHrEmail: string | null;
  assignedHrName: string | null;
  processingStatus: string;
  notificationStatus: string;
  notificationAttempts: number;
  notificationError: string | null;
  notifiedAt: Date | null;
  gmailMessageId: string;
  attachmentId: string | null;
  filename: string | null;
  mimeType: string | null;
  attachmentSize: number | null;
  analyzedAt: Date;
  createdAt: Date;
}

export interface ExcelRowError {
  row: number;
  candidateId?: number;
  error: string;
}

export interface ExcelSyncResult {
  status: ExcelSyncStatus;
  fileHash?: string;
  totalRows: number;
  processedRows: number;
  updatedRows: number;
  skippedRows: number;
  errorCount: number;
  errors: ExcelRowError[];
  durationMs: number;
  startedAt: Date;
  completedAt: Date;
  triggerSource: ExcelSyncTrigger;
  message?: string;
}

export type CallOutcome =
  | 'Not Answered'
  | 'Answered'
  | 'Busy'
  | 'Call Back Requested'
  | 'Invalid Number'
  | 'Switched Off';

export interface CallAttemptRecord {
  attemptNumber: number;
  callDate: string;
  formattedCallDate?: string;
  status: CallOutcome;
  assignedHrId?: string;
  assignedHrName?: string;
  assignedHrEmail?: string;
  notes?: string;
  nextFollowUpDate?: string;
  isQualifyingUnanswered: boolean;
}

export interface SaveCandidateInput {
  id?: number;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  jobRole?: string | null;
  normalizedRole?: string | null;
  assignedHrName?: string | null;
  assignedHrEmail?: string | null;
  experience?: any;
  company?: string | null;
  screeningStatus: string;
  applicationStatus?: string;
  rejectionReason?: string | null;
  hrRemarks?: string | null;
  matchScore?: number | null;
  summary?: string | null;
  recommendation?: string | null;
  originalResume?: string | null;
  gmailMessageId?: string | null;
  notificationStatus?: string | null;
  currentInterviewRound?: string | null;
  callCount?: number | null;
  totalCallAttempts?: number | null;
  call1Date?: string | null;
  call1Status?: string | null;
  call1Remarks?: string | null;
  call2Date?: string | null;
  call2Status?: string | null;
  call2Remarks?: string | null;
  call3Date?: string | null;
  call3Status?: string | null;
  call3Remarks?: string | null;
  lastCallStatus?: string | null;
  lastContactDate?: string | null;
  nextFollowUpDate?: string | null;
  call1DateAndStatus?: string | null;
  call2DateAndStatus?: string | null;
  call3DateAndStatus?: string | null;
  lastCallDate?: string | null;
  automatedFollowUpEmailStatus?: string | null;
  followUpEmailSentAt?: string | null;
}

export interface ExcelCandidateRecord {
  id: number;
  name: string;
  email: string;
  phone: string;
  jobRole: string;
  normalizedRole?: string;
  assignedHrName: string;
  assignedHrEmail?: string;
  screeningStatus: 'SHORTLIST' | 'REJECT' | 'MANUAL_REVIEW' | string;
  applicationStatus?: string;
  rejectionReason?: string | null;
  hrRemarks?: string | null;
  matchScore: number | null;
  summary: string;
  originalResume?: string;
  gmailMessageId?: string;
  notificationStatus?: string;
  currentInterviewRound?: string;
  callCount?: number;
  totalCallAttempts?: number;
  call1Date?: string;
  call1Status?: string;
  call1Remarks?: string;
  call2Date?: string;
  call2Status?: string;
  call2Remarks?: string;
  call3Date?: string;
  call3Status?: string;
  call3Remarks?: string;
  lastCallStatus?: string;
  lastContactDate?: string;
  nextFollowUpDate?: string;
  call1DateAndStatus?: string;
  call2DateAndStatus?: string;
  call3DateAndStatus?: string;
  lastCallDate?: string;
  automatedFollowUpEmailStatus?: string;
  followUpEmailSentAt?: string;
  candidateReplied?: boolean;
  experience?: any;
  currentCompany?: string;
  company?: string | null;
  createdAt?: string;
  updatedAt?: string;
  recommendation?: string;
  matchedRequirements?: string[];
  missingRequirements?: string[];
  screeningExplanation?: string;
}
