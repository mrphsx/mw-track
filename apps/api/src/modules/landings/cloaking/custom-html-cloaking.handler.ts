import { Injectable } from '@nestjs/common';
import { Landing, CloakingRule } from '@prisma/client';
import { Request, Response } from 'express';
import { CloakingHandler } from './cloaking-handler.interface';

// Keitaro "Show as HTML-page" — произвольный HTML/баннерный код правила, как есть.
@Injectable()
export class CustomHtmlCloakingHandler implements CloakingHandler {
  async serveBlockedVisitor(_landing: Landing, rule: CloakingRule, _subPath: string, _req: Request, res: Response): Promise<void> {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(rule.actionCustomHtml || '');
  }
}
