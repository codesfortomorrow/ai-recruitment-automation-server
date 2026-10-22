import { forwardRef, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma';
import { RedisModule } from '../redis';
import { MailModule } from '../mail';
import { CandidateController } from './candidate.controller';
import { CandidateService } from './candidate.service';
import { HrAssignmentService } from './hr-assignment.service';
import { CandidateNotificationService } from './candidate-notification.service';
import { CandidateExcelService } from './candidate-excel.service';
import { GoogleSheetsService } from './google-sheets.service';
import { GoogleDriveService } from './google-drive.service';

@Module({
  imports: [PrismaModule, RedisModule, forwardRef(() => MailModule)],
  controllers: [CandidateController],
  providers: [
    CandidateService,
    HrAssignmentService,
    CandidateNotificationService,
    CandidateExcelService,
    GoogleSheetsService,
    GoogleDriveService,
  ],
  exports: [
    CandidateService,
    HrAssignmentService,
    CandidateNotificationService,
    CandidateExcelService,
    GoogleSheetsService,
    GoogleDriveService,
  ],
})
export class CandidateModule {}
