import * as path from 'path';
import { Injectable, Logger } from '@nestjs/common';
import { Landing } from '@prisma/client';
import { Request, Response } from 'express';
import { StorageService } from '../storage.service';
import { CloakingHandler } from './cloaking-handler.interface';
import { RedirectCloakingHandler } from './redirect-cloaking.handler';

// Отдаёт заранее загруженную статическую white page (запрос пользователя 2026-09-23) — тот же
// паттерн раздачи из MinIO, что и LandingRendererService.serveCustomFile для CUSTOM-лендинга,
// но НАМЕРЕННО без injectTrackingScripts: заблокированный по гео посетитель не должен получать
// никакого трекинга — тот же инвариант, что уже действовал для REDIRECT (см. комментарий в
// LandingRendererService.renderAndServe).
@Injectable()
export class PrelandingCloakingHandler implements CloakingHandler {
  private readonly logger = new Logger(PrelandingCloakingHandler.name);

  constructor(
    private readonly storage: StorageService,
    private readonly redirectHandler: RedirectCloakingHandler,
  ) {}

  async serveBlockedVisitor(landing: Landing, subPath: string, req: Request, res: Response): Promise<void> {
    // Тип выбран, но white page ещё не загружена (или удалена) — безопасный дефолт: тот же,
    // что у REDIRECT, а не 404/500 наружу заблокированному посетителю. cloakingType и upload —
    // два независимых запроса без гарантированного порядка, это не ошибочное состояние.
    if (!landing.cloakingPrelandingBasePath) {
      await this.redirectHandler.serveBlockedVisitor(landing, subPath, req, res);
      return;
    }

    const isIndex = !subPath || subPath === 'index.html';
    const key = `${landing.cloakingPrelandingBasePath}/${isIndex ? 'index.html' : subPath}`;

    try {
      if (isIndex) {
        const buffer = await this.storage.getObjectBuffer(key);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-store');
        res.removeHeader('Content-Security-Policy');
        res.send(buffer.toString('utf-8'));
        return;
      }

      const stream = await this.storage.getObjectStream(key);
      res.type(path.extname(key) || '.bin');
      stream.on('error', () => {
        if (!res.headersSent) res.status(404).send('Not found');
      });
      stream.pipe(res);
    } catch (error) {
      this.logger.warn(`PrelandingCloakingHandler failed for ${key}: ${(error as Error).message}`);
      res.status(404).send(isIndex ? '<h1>Page not found</h1>' : 'Not found');
    }
  }
}
