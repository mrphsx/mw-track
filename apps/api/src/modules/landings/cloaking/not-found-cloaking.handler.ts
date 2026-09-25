import { Injectable } from '@nestjs/common';
import { Landing, CloakingRule } from '@prisma/client';
import { Request, Response } from 'express';
import { CloakingHandler } from './cloaking-handler.interface';

// Keitaro "404 Not Found" — пустое тело с реальным HTTP-статусом 404.
@Injectable()
export class NotFoundCloakingHandler implements CloakingHandler {
  async serveBlockedVisitor(_landing: Landing, _rule: CloakingRule, _subPath: string, _req: Request, res: Response): Promise<void> {
    res.status(404).send('');
  }
}
