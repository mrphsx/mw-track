import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { AutomationEngineService } from './automation-engine.service';

@Processor('automation-steps')
export class AutomationStepProcessor {
  private readonly logger = new Logger(AutomationStepProcessor.name);

  constructor(private engine: AutomationEngineService) {}

  @Process('advance')
  async advance(job: Job<{ enrollmentId: string }>) {
    try {
      await this.engine.advance(job.data.enrollmentId);
    } catch (error) {
      this.logger.error(`advance() failed for enrollment ${job.data.enrollmentId}: ${(error as Error).message}`);
      throw error; // BullMQ ретраит согласно attempts/backoff джобы
    }
  }
}
