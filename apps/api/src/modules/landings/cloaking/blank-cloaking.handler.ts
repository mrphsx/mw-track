import { Injectable } from '@nestjs/common';
import { Landing, CloakingRule } from '@prisma/client';
import { Request, Response } from 'express';
import { CloakingHandler } from './cloaking-handler.interface';

// Keitaro "Do Nothing" — пустое тело с обычным 200.
@Injectable()
export class BlankCloakingHandler implements CloakingHandler {
  async serveBlockedVisitor(_landing: Landing, _rule: CloakingRule, _subPath: string, _req: Request, res: Response): Promise<void> {
    res.status(200).send('');
  }
}
