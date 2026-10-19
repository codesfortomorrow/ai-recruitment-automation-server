import { ResumeAnalysisResult } from './gemini.types';

export interface GmailMessageSummary {
  id: string;
  threadId: string;
}

export interface GmailAttachmentMeta {
  filename: string;
  mimeType: string;
  size: number;
  attachmentId?: string;
}

export interface GmailMessageSender {
  email: string;
  name?: string;
}

export type ResumeExtractionStatus = 'success' | 'failed' | 'skipped';

export interface ResumeExtractionResult {
  attachmentId?: string;
  filename: string;
  mimeType: string;
  size: number;
  status: ResumeExtractionStatus;
  text?: string;
  error?: string;
  fingerprint?: string;
  isDuplicate?: boolean;
  lockToken?: string;
}

export interface GmailMessageDetail {
  id: string;
  threadId: string;
  sender: GmailMessageSender;
  recipient: string;
  subject: string;
  receivedDate: Date;
  snippet: string;
  textBody?: string;
  htmlBody?: string;
  attachments: GmailAttachmentMeta[];
  resumes?: ResumeExtractionResult[];
  analyses?: ResumeAnalysisResult[];
}

export interface GmailConnectionStatus {
  configured: boolean;
  user: string;
  searchFilter: string;
  pollingEnabled: boolean;
  maxAttachmentSize: number;
  error?: string;
}

export interface GmailListResponse {
  messages: GmailMessageSummary[];
  nextPageToken?: string;
  resultSizeEstimate?: number;
}
