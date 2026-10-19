import { Queue } from 'bullmq';
import { forwardRef, Module, OnApplicationShutdown } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { MAIL_QUEUE } from './mail.constants';
import { MailService } from './mail.service';
import { MailProcessor } from './mail.processor';
import { GmailService } from './gmail.service';
import { GeminiService } from './gemini.service';
import { ResumeFingerprintService } from './resume-fingerprint.service';
import { ResumeScreeningQueueService } from './resume-screening-queue.service';
import { ResumeScreeningWorkerService } from './resume-screening-worker.service';
import { RoleDetectionService } from './role-detection.service';
import { MailController } from './mail.controller';
import { QueueModule } from '../queue';
import { RedisModule } from '../redis';
import { PrismaModule } from '../prisma';
import { CandidateModule } from '../candidate';

@Module({
  imports: [
    QueueModule.registerAsync(MAIL_QUEUE),
    RedisModule,
    PrismaModule,
    forwardRef(() => CandidateModule),
  ],
  controllers: [MailController],
  providers: [
    MailService,
    MailProcessor,
    GmailService,
    GeminiService,
    ResumeFingerprintService,
    ResumeScreeningQueueService,
    ResumeScreeningWorkerService,
    RoleDetectionService,
  ],
  exports: [
    MailService,
    GmailService,
    GeminiService,
    ResumeFingerprintService,
    ResumeScreeningQueueService,
    ResumeScreeningWorkerService,
    RoleDetectionService,
  ],
})
export class MailModule implements OnApplicationShutdown {
  constructor(
    @InjectQueue(MAIL_QUEUE)
    private readonly mailQueue: Queue,
  ) {}

  async onApplicationShutdown() {
    await this.mailQueue.disconnect();
  }
}
