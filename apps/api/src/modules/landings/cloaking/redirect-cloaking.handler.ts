import { Injectable } from '@nestjs/common';
import { Landing } from '@prisma/client';
import { Request, Response } from 'express';
import { CloakingHandler } from './cloaking-handler.interface';

// Клоакинг без явно заданной cloakingRedirectUrl — куда отправлять посетителей из
// не-разрешённых стран по умолчанию (запрос пользователя 2026-07-03, пример "например
// википедия"). Также fallback для PRELANDING без загруженной white page — см.
// PrelandingCloakingHandler.
export const DEFAULT_CLOAK_REDIRECT_URL = 'https://en.wikipedia.org';

@Injectable()
export class RedirectCloakingHandler implements CloakingHandler {
  async serveBlockedVisitor(landing: Landing, _subPath: string, _req: Request, res: Response): Promise<void> {
    res.redirect(302, landing.cloakingRedirectUrl || DEFAULT_CLOAK_REDIRECT_URL);
  }
}
