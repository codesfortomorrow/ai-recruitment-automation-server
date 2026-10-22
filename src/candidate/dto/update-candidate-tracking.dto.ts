import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class UpdateCandidateTrackingDto {
  @ApiPropertyOptional({
    description: 'Call-back status (e.g. Pending, Completed, Missed)',
    example: 'Completed',
  })
  @IsOptional()
  @IsString()
  callbackStatus?: string;

  @ApiPropertyOptional({
    description:
      'Call outcome or status (e.g. Received, Returned, Not Applicable)',
    example: 'Received',
  })
  @IsOptional()
  @IsString()
  callStatus?: string;

  @ApiPropertyOptional({
    description: 'Current Interview Round',
    example: 'Technical Round 1',
  })
  @IsOptional()
  @IsString()
  currentInterviewRound?: string;

  @ApiPropertyOptional({
    description: 'HR Remarks or notes',
    example: 'Spoke with candidate, confirmed interview availability',
  })
  @IsOptional()
  @IsString()
  hrRemarks?: string;

  @ApiPropertyOptional({
    description:
      'Target field key for direct updates from UI (e.g. status, call)',
    example: 'status',
  })
  @IsOptional()
  @IsString()
  key?: string;

  @ApiPropertyOptional({
    description: 'Target field value for direct updates from UI',
    example: 'Completed',
  })
  @IsOptional()
  @IsString()
  value?: string;
}
