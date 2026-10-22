import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
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
import { CandidateService } from './candidate.service';
import { CandidateExcelService } from './candidate-excel.service';
import { GoogleSheetsService } from './google-sheets.service';
import { GoogleDriveService } from './google-drive.service';
import { CandidateQueryDto } from './dto/candidate-query.dto';
import { RunExcelSyncDto } from './dto/run-excel-sync.dto';
import { ExcelSyncLogsQueryDto } from './dto/excel-sync-logs-query.dto';
import { RecordCallAttemptDto } from './dto/record-call-attempt.dto';
import { UpdateCandidateTrackingDto } from './dto/update-candidate-tracking.dto';
import { ExcelSyncTrigger } from '../generated/prisma/client';

@ApiTags('Candidates')
@ApiBearerAuth()
@Roles(UserType.Admin, UserType.User)
@UseGuards(JwtAuthGuard, AccessGuard, RolesGuard)
@Controller('candidates')
export class CandidateController extends BaseController {
  constructor(
    private readonly candidateService: CandidateService,
    private readonly candidateExcelService: CandidateExcelService,
    private readonly googleSheetsService: GoogleSheetsService,
    private readonly googleDriveService: GoogleDriveService,
  ) {
    super({ loggerDefaultMeta: { controller: CandidateController.name } });
  }

  @ApiOperation({
    summary:
      'Retrieve operational status and configuration of Google Sheets integration',
  })
  @ApiResponse({
    status: 200,
    description: 'Current configuration status and spreadsheet metadata',
  })
  @Get('google-sheets/status')
  getGoogleSheetsStatus() {
    return this.candidateService.getGoogleSheetsStatus();
  }

  @ApiOperation({
    summary:
      'Retrieve pending candidates awaiting Google Sheets synchronization retry',
  })
  @ApiResponse({
    status: 200,
    description: 'List of pending candidate IDs and sync status',
  })
  @Get('google-sheets/pending-sync')
  async getPendingSheetsSync() {
    return await this.candidateService.getPendingSheetsSyncCandidates();
  }

  @ApiOperation({
    summary:
      'Trigger retry of all pending candidate Google Sheets synchronizations',
  })
  @ApiResponse({
    status: 200,
    description: 'Count of succeeded and failed retry synchronizations',
  })
  @Roles(UserType.Admin)
  @HttpCode(HttpStatus.OK)
  @Post('google-sheets/retry-pending')
  async retryPendingSheetsSync() {
    return await this.candidateService.retryAllPendingSheetsSync();
  }

  @ApiOperation({
    summary:
      'Explicitly check and migrate Google Sheets Candidate Tracker schema',
  })
  @ApiResponse({
    status: 200,
    description: 'Migration execution result with schema verification',
  })
  @Roles(UserType.Admin)
  @HttpCode(HttpStatus.OK)
  @Post('google-sheets/migrate')
  async migrateGoogleSheetsSchema() {
    return await this.googleSheetsService.ensureCandidateTrackerSheet();
  }

  @ApiOperation({
    summary:
      'Trigger manual polling and reconciliation from Google Sheets Candidate Tracker',
  })
  @ApiResponse({
    status: 200,
    description: 'Result of the Google Sheets polling run',
  })
  @Roles(UserType.Admin)
  @HttpCode(HttpStatus.OK)
  @Post('google-sheets/sync')
  async pollGoogleSheets(@Query('force') force?: string) {
    return await this.candidateService.pollGoogleSheetsForCallUpdates({
      triggerSource: 'MANUAL',
      force: force === 'true' || force === '1',
    });
  }

  @ApiOperation({
    summary:
      'Retrieve operational status and configuration of Google Drive CV folder integration',
  })
  @ApiResponse({
    status: 200,
    description: 'Current configuration status and folder metadata',
  })
  @Get('google-drive/status')
  getGoogleDriveStatus() {
    return {
      configured: this.googleDriveService.isConfigured(),
      issue: this.googleDriveService.getConfigurationIssue() || undefined,
      missingFolders: this.googleDriveService.getMissingFolderConfig(),
      folders: this.googleDriveService.getConfiguredFolders(),
      folderId: (this.googleDriveService as any).config?.folderId || undefined,
      folderName:
        (this.googleDriveService as any).config?.folderName ||
        'Central Repository of Resume',
      pollingEnabled: this.googleDriveService.isPollingEnabled(),
    };
  }

  @ApiOperation({
    summary:
      'Trigger manual scan and processing of new CV files in the central Google Drive folder',
  })
  @ApiResponse({
    status: 200,
    description: 'Count of newly discovered and processed CV files',
  })
  @Roles(UserType.Admin)
  @HttpCode(HttpStatus.OK)
  @Post('google-drive/poll')
  async pollGoogleDrive() {
    const processed = await this.googleDriveService.pollAndProcessNewFiles();
    return {
      success: true,
      processedCount: processed,
      timestamp: new Date().toISOString(),
    };
  }

  @ApiOperation({
    summary:
      'Trigger manual reconciliation of misassigned recruitment candidates to Jayendra (HR2)',
  })
  @ApiResponse({
    status: 200,
    description: 'Summary of the reconciled candidates',
  })
  @Roles(UserType.Admin)
  @Post('hr-assignment/reconcile')
  async reconcileHrAssignment() {
    return await this.candidateService.reconcileMisassignedRecruitmentCandidates();
  }

  @ApiOperation({
    summary:
      'Trigger manual synchronization and validation from candidate Excel file',
  })
  @ApiResponse({
    status: 200,
    description: 'Summary of the Excel synchronization execution',
  })
  @Post('excel-sync/run')
  async runExcelSync(@Body() dto: RunExcelSyncDto) {
    return await this.candidateExcelService.syncFromExcel({
      triggerSource: ExcelSyncTrigger.Manual,
      force: Boolean(dto?.force),
    });
  }

  @ApiOperation({
    summary: 'Retrieve operational status and metrics of Excel candidate store',
  })
  @ApiResponse({
    status: 200,
    description: 'Operational status, schedule, and last sync metrics',
  })
  @Get('excel-sync/status')
  async getExcelSyncStatus() {
    return await this.candidateExcelService.getSyncStatus();
  }

  @ApiOperation({
    summary: 'Retrieve paginated Excel synchronization history logs',
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of Excel synchronization logs',
  })
  @Get('excel-sync/logs')
  async getExcelSyncLogs(@Query() query: ExcelSyncLogsQueryDto) {
    return await this.candidateExcelService.getSyncLogs(
      query.page,
      query.limit,
    );
  }

  @ApiOperation({
    summary:
      'Retrieve recruitment dashboard statistics and pipeline counts from Excel',
  })
  @ApiResponse({
    status: 200,
    description:
      'Current counts for total, shortlisted, rejected, and manual review candidates',
  })
  @Get('stats')
  async getDashboardStats() {
    return await this.candidateService.getDashboardStats();
  }

  @ApiOperation({
    summary:
      'List candidates with pagination, filtering, and text search from Excel',
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated candidate list with total count',
  })
  @Get()
  async getCandidates(@Query() query: CandidateQueryDto) {
    return await this.candidateService.findCandidates(query);
  }

  @ApiOperation({
    summary: 'Retrieve detailed candidate profile by ID from Excel',
  })
  @ApiParam({
    name: 'id',
    type: Number,
    description: 'Candidate ID',
  })
  @Get(':id')
  async getCandidateProfile(@Param('id', ParseIntPipe) id: number) {
    return await this.candidateService.getCandidateById(id);
  }

  @ApiOperation({
    summary: 'Download or preview candidate original resume attachment',
  })
  @ApiParam({
    name: 'id',
    type: Number,
    description: 'Candidate ID',
  })
  @Get(':id/resume')
  async downloadResume(
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ) {
    const { buffer, filename, mimeType } =
      await this.candidateService.getResumeAttachment(id);

    res.set({
      'Content-Type': mimeType,
      'Content-Disposition': `inline; filename="${encodeURIComponent(filename)}"`,
      'Content-Length': buffer.length.toString(),
    });

    res.end(buffer);
  }

  @ApiOperation({
    summary:
      'Record an HR manual call attempt, update candidate tracking, and trigger automated follow-up if applicable',
  })
  @ApiParam({
    name: 'id',
    type: Number,
    description: 'Candidate ID',
  })
  @ApiResponse({
    status: 200,
    description:
      'Call attempt recorded successfully with updated tracking fields and follow-up status',
  })
  @Post(':id/call-attempts')
  async recordCallAttempt(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RecordCallAttemptDto,
    @Req() req: any,
  ) {
    return await this.candidateService.recordCallAttempt(id, dto, req?.user);
  }

  @ApiOperation({
    summary:
      'Retrieve complete persistent HR call attempt history and follow-up status for candidate',
  })
  @ApiParam({
    name: 'id',
    type: Number,
    description: 'Candidate ID',
  })
  @ApiResponse({
    status: 200,
    description:
      'Candidate call attempt history, attempt metrics, and automated follow-up email status',
  })
  @Get(':id/call-attempts')
  async getCallAttempts(@Param('id', ParseIntPipe) id: number) {
    return await this.candidateService.getCallAttempts(id);
  }

  @ApiOperation({
    summary:
      'Mark candidate as replied (exits the automated follow-up email workflow)',
  })
  @ApiParam({
    name: 'id',
    type: Number,
    description: 'Candidate ID',
  })
  @ApiResponse({
    status: 200,
    description: 'Candidate marked as replied and follow-up workflow exited',
  })
  @Post(':id/mark-replied')
  async markCandidateReplied(@Param('id', ParseIntPipe) id: number) {
    return await this.candidateService.markCandidateReplied(id);
  }
  @ApiOperation({
    summary:
      'Update candidate tracking, call-back status, and notes in Google Sheets',
  })
  @ApiParam({
    name: 'id',
    type: Number,
    description: 'Candidate ID',
  })
  @ApiResponse({
    status: 200,
    description: 'Candidate tracking updated successfully in Google Sheets',
  })
  @Patch(':id/tracking')
  async updateCandidateTracking(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCandidateTrackingDto,
    @Req() req: any,
  ) {
    return await this.candidateService.updateCandidateTracking(
      id,
      dto,
      req?.user,
    );
  }
}
