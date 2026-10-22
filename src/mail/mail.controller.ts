import {
  Controller,
  DefaultValuePipe,
  forwardRef,
  Get,
  Inject,
  Optional,
  Param,
  ParseBoolPipe,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import {
  AccessGuard,
  BaseController,
  JwtAuthGuard,
  Roles,
  RolesGuard,
  UserType,
} from '@Common';
import { GmailService } from './gmail.service';
import { GeminiService } from './gemini.service';
import { CandidateService } from '../candidate/candidate.service';
import { ResumeScreeningQueueService } from './resume-screening-queue.service';
import { ResumeScreeningWorkerService } from './resume-screening-worker.service';
import { ScreeningJobStatus } from './gemini.types';

@ApiTags('Mail')
@ApiBearerAuth()
@Roles(UserType.Admin)
@UseGuards(JwtAuthGuard, AccessGuard, RolesGuard)
@Controller('mail')
export class MailController extends BaseController {
  constructor(
    private readonly gmailService: GmailService,
    private readonly geminiService: GeminiService,
    @Optional()
    @Inject(forwardRef(() => CandidateService))
    private readonly candidateService?: CandidateService,
    @Optional()
    private readonly queueService?: ResumeScreeningQueueService,
    @Optional()
    private readonly workerService?: ResumeScreeningWorkerService,
  ) {
    super({ loggerDefaultMeta: { controller: MailController.name } });
  }

  @ApiOperation({
    summary:
      'Check Gmail recruitment inbox and Google Gemini integration status',
  })
  @Get('gmail/status')
  async getStatus() {
    const gmailStatus = await this.gmailService.getStatus();
    return {
      ...gmailStatus,
      gemini: {
        configured: this.geminiService.isConfigured(),
        model: this.geminiService.getModel(),
        analysisAvailable: this.geminiService.isConfigured(),
      },
    };
  }

  @ApiOperation({
    summary: 'Retrieve recent messages from recruitment inbox for testing',
  })
  @ApiQuery({
    name: 'take',
    required: false,
    type: Number,
    description: 'Number of messages to retrieve (max 20, default 5)',
  })
  @ApiQuery({
    name: 'query',
    required: false,
    type: String,
    description: 'Gmail search query filter',
  })
  @ApiQuery({
    name: 'extractResumes',
    required: false,
    type: Boolean,
    description:
      'Whether to download and extract resume text for attachments (default false)',
  })
  @ApiQuery({
    name: 'analyzeWithGemini',
    required: false,
    type: Boolean,
    description:
      'Whether to execute Google Gemini analysis on extracted application/resumes (default false)',
  })
  @Get('gmail/messages')
  async getRecentMessages(
    @Query('take', new DefaultValuePipe(5), ParseIntPipe) take: number,
    @Query('query') query?: string,
    @Query('extractResumes', new DefaultValuePipe(false), ParseBoolPipe)
    extractResumes?: boolean,
    @Query('analyzeWithGemini', new DefaultValuePipe(false), ParseBoolPipe)
    analyzeWithGemini?: boolean,
  ) {
    const maxResults = Math.min(Math.max(take, 1), 20);
    const listResult = await this.gmailService.listMessages({
      query,
      maxResults,
    });

    const shouldAnalyze = analyzeWithGemini;
    const messages = [];
    for (const item of listResult.messages) {
      const detail = await this.gmailService.getMessage(item.id);

      let resumes;
      if (extractResumes && detail.attachments.length > 0) {
        const processResult = await this.gmailService.processMessageResumes(
          item.id,
          detail.attachments,
        );
        resumes = processResult.resumes;
        detail.resumes = resumes;
      }

      let analyses;
      if (shouldAnalyze) {
        const analysisResult =
          await this.gmailService.analyzeMessageWithGemini(detail);
        analyses = analysisResult.analyses;
      }

      messages.push({
        id: detail.id,
        threadId: detail.threadId,
        sender: detail.sender,
        recipient: detail.recipient,
        subject: detail.subject,
        receivedDate: detail.receivedDate,
        snippet: detail.snippet,
        attachmentCount: detail.attachments.length,
        attachments: detail.attachments,
        resumes,
        analyses,
      });
    }

    return {
      count: messages.length,
      resultSizeEstimate: listResult.resultSizeEstimate,
      nextPageToken: listResult.nextPageToken,
      messages,
    };
  }

  @ApiOperation({
    summary: 'Download and extract text from a specific resume attachment',
  })
  @ApiParam({
    name: 'messageId',
    type: String,
    description: 'Gmail Message ID',
  })
  @ApiParam({
    name: 'attachmentId',
    type: String,
    description: 'Gmail Attachment ID',
  })
  @ApiQuery({
    name: 'filename',
    required: false,
    type: String,
    description: 'Original filename for format detection',
  })
  @Get('gmail/messages/:messageId/attachments/:attachmentId')
  async extractAttachment(
    @Param('messageId') messageId: string,
    @Param('attachmentId') attachmentId: string,
    @Query('filename') filename?: string,
  ) {
    const resolvedFilename = filename || 'resume.pdf';
    return await this.gmailService.extractAttachmentResume(messageId, {
      attachmentId,
      filename: resolvedFilename,
      mimeType: resolvedFilename.toLowerCase().endsWith('.docx')
        ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        : 'application/pdf',
      size: 0,
    });
  }

  @ApiOperation({
    summary: 'Retrieve stored Google Gemini analyses for a specific message',
  })
  @ApiParam({
    name: 'messageId',
    type: String,
    description: 'Gmail Message ID',
  })
  @Get('gmail/messages/:messageId/analysis')
  async getStoredAnalysis(@Param('messageId') messageId: string) {
    const analyses =
      await this.geminiService.getStoredMessageAnalyses(messageId);
    return {
      messageId,
      count: analyses.length,
      analyses,
    };
  }

  @ApiOperation({
    summary:
      'Manually trigger Google Gemini analysis on a specific email message',
  })
  @ApiParam({
    name: 'messageId',
    type: String,
    description: 'Gmail Message ID',
  })
  @Post('gmail/messages/:messageId/analyze')
  async analyzeMessage(@Param('messageId') messageId: string) {
    const detail = await this.gmailService.getMessage(messageId);
    if (detail.attachments.length > 0) {
      const processResult = await this.gmailService.processMessageResumes(
        messageId,
        detail.attachments,
      );
      detail.resumes = processResult.resumes;
    }

    const result = await this.gmailService.analyzeMessageWithGemini(detail);

    if (this.candidateService && result.analyses.length > 0) {
      for (const analysis of result.analyses) {
        if (analysis.status === 'success') {
          try {
            await this.candidateService.persistAndProcessScreeningResult({
              messageDetail: detail,
              analysisResult: analysis,
            });
          } catch (persistErr: any) {
            this.logger.error('Failed to persist screening result', {
              messageId,
              cause: persistErr.message,
            });
          }
        }
      }
    }

    return result;
  }

  @ApiOperation({
    summary: 'Manually trigger recruitment email check and detection',
  })
  @Post('gmail/poll')
  async triggerPoll() {
    await this.gmailService.pollInbox();
    return {
      status: 'success',
      message: 'Recruitment inbox check completed',
    };
  }

  @ApiOperation({
    summary:
      'List all durable resume screening jobs with status and retry metadata',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: [
      'PENDING',
      'PROCESSING',
      'RETRY_WAIT',
      'COMPLETED',
      'FAILED_PERMANENTLY',
    ],
    description: 'Filter by job screening status',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Max jobs to return (default 50)',
  })
  @ApiQuery({
    name: 'offset',
    required: false,
    type: Number,
    description: 'Pagination offset (default 0)',
  })
  @Get('screening/jobs')
  async listScreeningJobs(
    @Query('status') status?: ScreeningJobStatus,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit?: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset?: number,
  ) {
    if (!this.queueService) {
      return { total: 0, jobs: [] };
    }
    return await this.queueService.listJobs({ status, limit, offset });
  }

  @ApiOperation({
    summary: 'Get details for a specific screening job by ID / fingerprint',
  })
  @ApiParam({
    name: 'jobId',
    type: String,
    description: 'Job ID (resume SHA-256 fingerprint)',
  })
  @Get('screening/jobs/:jobId')
  async getScreeningJob(@Param('jobId') jobId: string) {
    if (!this.queueService) {
      return null;
    }
    const job = await this.queueService.getJob(jobId);
    if (!job) {
      return { status: 'not_found', message: `Job ${jobId} not found` };
    }
    return job;
  }

  @ApiOperation({
    summary: 'Manually retry a failed, stuck, or dead-letter screening job',
  })
  @ApiParam({
    name: 'jobId',
    type: String,
    description: 'Job ID (resume SHA-256 fingerprint)',
  })
  @Post('screening/jobs/:jobId/retry')
  async retryScreeningJob(@Param('jobId') jobId: string) {
    if (!this.queueService) {
      throw new Error('Screening queue service is not available');
    }
    const job = await this.queueService.retryJobManually(jobId);

    if (this.workerService) {
      const processed = await this.workerService.processSingleJob(job);
      return {
        status: 'success',
        message: `Screening job ${jobId} retried successfully`,
        job: processed,
      };
    }

    return {
      status: 'success',
      message: `Screening job ${jobId} scheduled for retry`,
      job,
    };
  }

  @ApiOperation({
    summary: 'List ambiguous candidate emails held in review state',
  })
  @Get('review/ambiguous')
  async listAmbiguousEmails() {
    const classifier = this.gmailService.getClassifierService();
    const reviews = await classifier.getAmbiguousReviews();
    return {
      total: reviews.length,
      ambiguousEmails: reviews,
    };
  }
}
