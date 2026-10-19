import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

export class RunExcelSyncDto {
  @ApiPropertyOptional({
    default: false,
    description:
      'Force synchronization even if file content hash has not changed',
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === true || value === 'true')
  force?: boolean = false;
}
