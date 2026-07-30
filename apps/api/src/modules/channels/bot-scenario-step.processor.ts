import { Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import { BotScenarioEngineService } from './bot-scenario-engine.service';

export interface BotScenarioStepJob {
  runId: string;
}

// Заменяет старый BotScenarioMessageProcessor (одно сообщение, одна задержка) — теперь очередь
// просто продолжает продвижение цепочки шагов, вся логика (какой шаг дальше, отправка,
// условие) — в BotScenarioEngineService.advance(), тот же приём, что automation-step.processor.ts
// использует для автоворонок.
@Processor('bot-scenario-steps')
export class BotScenarioStepProcessor {
  constructor(private engine: BotScenarioEngineService) {}

  @Process('advance')
  async handle(job: Job<BotScenarioStepJob>) {
    await this.engine.advance(job.data.runId);
  }
}
