import { Injectable } from '@nestjs/common';
import { CloakingType, Landing } from '@prisma/client';
import { Request, Response } from 'express';
import { resolveVisitorCountry } from '../../../common/geo-country.util';
import { CloakingHandler } from './cloaking-handler.interface';
import { RedirectCloakingHandler } from './redirect-cloaking.handler';
import { PrelandingCloakingHandler } from './prelanding-cloaking.handler';

// Единая точка входа для клоакинга лендингов (запрос пользователя 2026-09-23, "вынести
// клоакинг как-то, дальше будет сильно расширяться") — реестр по CloakingType, тот же принцип,
// что ChannelsService.providers для типов каналов. LandingRendererService.renderAndServe
// вызывает только applyCloaking, не зная о конкретных типах клоакинга.
@Injectable()
export class CloakingService {
  private readonly handlers: Record<CloakingType, CloakingHandler>;

  constructor(redirectHandler: RedirectCloakingHandler, prelandingHandler: PrelandingCloakingHandler) {
    this.handlers = {
      REDIRECT: redirectHandler,
      PRELANDING: prelandingHandler,
    };
  }

  // true — запрос уже полностью обработан (посетитель заблокирован и получил альтернативный
  // контент), renderAndServe должен вернуться сразу же. false — клоакинг выключен либо
  // посетитель прошёл гео-проверку, рендерить реальный лендинг как обычно.
  async applyCloaking(landing: Landing, subPath: string, req: Request, res: Response): Promise<boolean> {
    if (!landing.cloakingEnabled || this.isCountryAllowed(req, landing.cloakingCountries)) return false;
    await this.handlers[landing.cloakingType].serveBlockedVisitor(landing, subPath, req, res);
    return true;
  }

  private isCountryAllowed(req: Request, allowedCountries: string[]): boolean {
    const country = resolveVisitorCountry(req);
    // Страна не определилась вообще — считаем посетителя НЕ разрешённым (безопаснее
    // спрятать лендинг лишний раз, чем случайно показать его тому, от кого клоакинг должен
    // скрывать — весь смысл опции в том, чтобы не светить лендинг перед не-целевой
    // аудиторией/модерацией рекламных сетей).
    if (!country) return false;
    return allowedCountries.includes(country);
  }
}
