import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';
import { SearchablePaginatedDto } from '@Common';

export enum CandidateFilterStatus {
  SHORTLIST = 'SHORTLIST',
  REJECT = 'REJECT',
  MANUAL_REVIEW = 'MANUAL_REVIEW',
}

export class CandidateQueryDto extends SearchablePaginatedDto {
  @ApiPropertyOptional({
    enum: CandidateFilterStatus,
    description: 'Filter candidates by screening status',
  })
  @IsOptional()
  @IsEnum(CandidateFilterStatus)
  status?: CandidateFilterStatus;

  @ApiPropertyOptional({
    description: 'Filter candidates by applied or normalized job role',
  })
  @IsOptional()
  @IsString()
  role?: string;

  @ApiPropertyOptional({
    description: 'Filter candidates by assigned HR email or ID',
  })
  @IsOptional()
  @IsString()
  assignedHr?: string;

  @ApiPropertyOptional({
    description: 'Filter candidates applied on or after this ISO date',
  })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({
    description: 'Filter candidates applied on or before this ISO date',
  })
  @IsOptional()
  @IsDateString()
  endDate?: string;
}
