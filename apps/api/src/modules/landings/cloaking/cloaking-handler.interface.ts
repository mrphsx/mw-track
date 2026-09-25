import { CloakingRule, Landing } from '@prisma/client';
import { Request, Response } from 'express';

// Один класс на CloakingActionType (по аналогии с ChannelProvider, см.
// apps/api/src/modules/channels/providers/channel.provider.interface.ts) — добавление нового
// действия клоакинга в будущем = новый класс + одна строка в реестре
// CloakingService.actionHandlers, без правок логики оценки правил.
export interface CloakingHandler {
  // Вызывается, когда движок правил (CloakingService.applyCloaking) нашёл первое совпавшее
  // правило с действием, отличным от ALLOW (ALLOW обрабатывается самим CloakingService, без
  // обращения к хендлеру — это "показать реальный лендинг", а не отдельный вид ответа).
  // subPath — тот же смысл, что в LandingRendererService.serveCustomFile: '' для корня,
  // 'style.css'/'img/logo.png' для остальных ассетов (нужно типам, отдающим свой статический
  // сайт — PRELANDING; остальные его игнорируют).
  serveBlockedVisitor(landing: Landing, rule: CloakingRule, subPath: string, req: Request, res: Response): Promise<void>;
}
