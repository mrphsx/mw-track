import { Injectable } from '@nestjs/common';
import { CloakingRule, Landing } from '@prisma/client';
import { Request, Response } from 'express';
import { CloakingHandler } from './cloaking-handler.interface';

// Правило без явно заданного actionRedirectUrl — куда отправлять заблокированных посетителей
// по умолчанию (запрос пользователя 2026-07-03, пример "например википедия"). Также fallback
// для PRELANDING без загруженной white page — см. PrelandingCloakingHandler.
export const DEFAULT_CLOAK_REDIRECT_URL = 'https://en.wikipedia.org';

@Injectable()
export class RedirectCloakingHandler implements CloakingHandler {
  async serveBlockedVisitor(_landing: Landing, rule: CloakingRule, _subPath: string, _req: Request, res: Response): Promise<void> {
    res.redirect(302, rule.actionRedirectUrl || DEFAULT_CLOAK_REDIRECT_URL);
  }
}
