import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
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
import { CandidateQueryDto } from './dto/candidate-query.dto';
import { RunExcelSyncDto } from './dto/run-excel-sync.dto';
import { ExcelSyncLogsQueryDto } from './dto/excel-sync-logs-query.dto';
import { RecordCallAttemptDto } from './dto/record-call-attempt.dto';
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
  ) {
    super({ loggerDefaultMeta: { controller: CandidateController.name } });
  }

  @ApiOperation({
    summary:
      'Explicitly check and migrate Google Sheets Candidate Tracker schema',
  })
  @ApiResponse({
    status: 200,
    description: 'Migration execution result with schema verification',
  })
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
  @Post('google-sheets/sync')
  async pollGoogleSheets(@Query('force') force?: string) {
    return await this.candidateService.pollGoogleSheetsForCallUpdates({
      triggerSource: 'MANUAL',
      force: force === 'true' || force === '1',
    });
  }

  @ApiOperation({
    summary:
      'Trigger manual reconciliation of misassigned recruitment candidates to Jayendra (HR2)',
  })
  @ApiResponse({
    status: 200,
    description: 'Summary of the reconciled candidates',
  })
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
}
