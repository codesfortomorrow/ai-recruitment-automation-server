import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export const CALL_OUTCOMES = [
  'Not Answered',
  'Answered',
  'Busy',
  'Call Back Requested',
  'Invalid Number',
  'Switched Off',
] as const;

export type CallOutcome = (typeof CALL_OUTCOMES)[number];

export class RecordCallAttemptDto {
  @ApiProperty({
    description: 'Call outcome status',
    enum: CALL_OUTCOMES,
    example: 'Not Answered',
  })
  @IsNotEmpty()
  @IsString()
  @IsIn(CALL_OUTCOMES as unknown as string[], {
    message: `status must be one of: ${CALL_OUTCOMES.join(', ')}`,
  })
  status!: CallOutcome;

  @ApiPropertyOptional({
    description:
      'Specific call attempt number (1, 2, or 3). If omitted, determined sequentially from candidate call history',
    example: 1,
  })
  @IsOptional()
  attemptNumber?: number;

  @ApiPropertyOptional({
    description:
      'Call date (YYYY-MM-DD). If omitted, the current date is recorded',
    example: '2026-10-16',
  })
  @IsOptional()
  @IsString()
  callDate?: string;

  @ApiPropertyOptional({
    description: 'Optional notes or remarks regarding the call attempt',
    example: 'Candidate phone was ringing, no response after 5 rings',
  })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({
    description:
      'Next follow-up date and time if applicable (e.g. Call Back Requested)',
    example: '2026-10-18 11:00 AM',
  })
  @IsOptional()
  @IsString()
  nextFollowUpDate?: string;

  @ApiPropertyOptional({
    description: 'Assigned HR ID performing the call attempt (e.g. hr-1, hr-2)',
    example: 'hr-1',
  })
  @IsOptional()
  @IsString()
  callerHrId?: string;

  @ApiPropertyOptional({
    description: 'Assigned HR Name performing the call attempt',
    example: 'Aastha',
  })
  @IsOptional()
  @IsString()
  callerHrName?: string;

  @ApiPropertyOptional({
    description: 'Assigned HR Email performing the call attempt',
    example: 'aasthanegi.mongoosetech@gmail.com',
  })
  @IsOptional()
  @IsString()
  callerHrEmail?: string;
}
