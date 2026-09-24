import { Landing } from '@prisma/client';
import { Request, Response } from 'express';

// Один класс на тип клоакинга (по аналогии с ChannelProvider, см.
// apps/api/src/modules/channels/providers/channel.provider.interface.ts) — добавление нового
// типа клоакинга в будущем (запрос пользователя 2026-09-23, "дальше клоакинг будет сильно
// расширяться") = новый класс + одна строка в реестре CloakingService.handlers, без правок
// LandingRendererService или if/else где-либо ещё.
export interface CloakingHandler {
  // Вызывается ТОЛЬКО когда клоакинг включён и посетитель НЕ прошёл гео-проверку (см.
  // CloakingService.applyCloaking) — что именно показать вместо реального лендинга.
  // subPath — тот же смысл, что в LandingRendererService.serveCustomFile: '' для корня,
  // 'style.css'/'img/logo.png' для остальных ассетов (нужно типам, отдающим свой статический
  // сайт — PRELANDING; REDIRECT его игнорирует).
  serveBlockedVisitor(landing: Landing, subPath: string, req: Request, res: Response): Promise<void>;
}
