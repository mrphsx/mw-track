import { Injectable } from '@nestjs/common';
import { Channel } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { FunnelConfig, resolveFunnelConfig } from '../../common/funnel-config';

const CACHE_TTL_MS = 30_000;

// Настройка воронки для обработчиков Telegram (бот и личка) — на каждое входящее событие нужен
// Project.funnelConfig, а channel в замыкании бота хранит только поля самого канала. Кэш на 30 с,
// плюс явный сброс при сохранении (ProjectsService.updateFunnel) — процесс API один, так что
// изменение применяется сразу.
@Injectable()
export class FunnelConfigService {
  private cache = new Map<string, { stored: unknown; at: number }>();

  constructor(private prisma: PrismaService) {}

  async forChannel(channel: Pick<Channel, 'projectId' | 'type' | 'tgMode' | 'tgDirectTraffic'>): Promise<FunnelConfig> {
    const cached = this.cache.get(channel.projectId);
    let stored: unknown;
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      stored = cached.stored;
    } else {
      const project = await this.prisma.project.findUnique({ where: { id: channel.projectId }, select: { funnelConfig: true } });
      stored = project?.funnelConfig ?? null;
      this.cache.set(channel.projectId, { stored, at: Date.now() });
    }
    return resolveFunnelConfig(stored, channel);
  }

  invalidate(projectId: string): void {
    this.cache.delete(projectId);
  }
}
