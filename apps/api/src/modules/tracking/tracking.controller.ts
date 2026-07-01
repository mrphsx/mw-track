import { createHmac } from 'crypto';
import {
  Body,
  Controller,
  ForbiddenException,
  Headers,
  NotFoundException,
  Param,
  Post,
  RawBodyRequest,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { nanoid } from 'nanoid';
import { Public } from '../../common/decorators/public.decorator';
import { ProjectsService } from '../projects/projects.service';
import { RedisService } from '../../redis/redis.service';
import { TrackingService } from './tracking.service';
import { TrackEventDto } from './dto/track-event.dto';

const REPLAY_WINDOW_MS = 5 * 60 * 1000;
const TG_START_TTL_SECONDS = 24 * 60 * 60;

@Controller('track')
export class TrackingController {
  constructor(
    private projectsService: ProjectsService,
    private trackingService: TrackingService,
    private redis: RedisService,
  ) {}

  // Браузерный SDK (track.js на лендинге) — публичный токен в URL, без подписи
  @Public()
  @Post(':publicToken/event')
  async trackEvent(
    @Param('publicToken') publicToken: string,
    @Body() dto: TrackEventDto,
    @Req() req: Request,
    @Headers('origin') origin?: string,
  ) {
    const project = await this.projectsService.findByPublicToken(publicToken);
    if (!project) throw new NotFoundException('Project not found');

    if (project.allowedDomains.length > 0 && origin) {
      const originHost = new URL(origin).hostname;
      if (!project.allowedDomains.includes(originHost)) {
        throw new ForbiddenException('Domain not allowed');
      }
    }

    return this.trackingService.recordEvent(project.id, {
      ...dto,
      ipAddress: this.getClientIp(req),
      userAgent: req.headers['user-agent'],
      source: 'BROWSER',
    });
  }

  // Серверный SDK (@trafficcrm/sdk) — secretKey + HMAC, без cookie/CORS
  @Public()
  @Post('server/:projectId/event')
  async trackServerEvent(
    @Param('projectId') projectId: string,
    @Body() dto: TrackEventDto,
    @Headers('x-signature') signature: string,
    @Headers('x-timestamp') timestamp: string,
    @Req() req: RawBodyRequest<Request>,
  ) {
    const project = await this.projectsService.findById(projectId);
    if (!project) throw new NotFoundException();

    if (!signature || !timestamp || !req.rawBody) {
      throw new UnauthorizedException('Missing signature');
    }

    // Подпись считается от ИСХОДНЫХ байт тела запроса (req.rawBody), а не от
    // JSON.stringify(dto) — после ValidationPipe/class-transformer это уже другая
    // строка (порядок ключей, типы), и подпись клиента никогда бы не совпала.
    const expectedSig = createHmac('sha256', project.secretKey)
      .update(`${timestamp}.${req.rawBody.toString('utf8')}`)
      .digest('hex');

    if (signature !== `sha256=${expectedSig}`) {
      throw new UnauthorizedException('Invalid signature');
    }

    if (Date.now() - Number(timestamp) > REPLAY_WINDOW_MS) {
      throw new UnauthorizedException('Request expired');
    }

    return this.trackingService.recordEvent(project.id, { ...dto, source: 'SDK' });
  }

  // Вызывается JS-сниппетом перед открытием t.me/<bot>?start=<code> — кладёт
  // накопленные fbclid/ttclid/utm в Redis на REDIS_BRIDGE-ключ, который читает
  // TelegramProvider.handleStart() при заходе пользователя в бота (см. шаг 1.5)
  @Public()
  @Post(':publicToken/tg-start')
  async createTgStartCode(@Param('publicToken') publicToken: string, @Body() body: Record<string, unknown>) {
    const project = await this.projectsService.findByPublicToken(publicToken);
    if (!project) throw new NotFoundException('Project not found');

    const startCode = nanoid(12);
    await this.redis.set(
      `start:${startCode}`,
      JSON.stringify({
        fbclid: body.fbclid,
        ttclid: body.ttclid,
        utmSource: body.utmSource,
        utmCampaign: body.utmCampaign,
      }),
      'EX',
      TG_START_TTL_SECONDS,
    );

    return { startCode };
  }

  private getClientIp(req: Request): string {
    return (
      (req.headers['cf-connecting-ip'] as string) ||
      (req.headers['x-real-ip'] as string) ||
      req.headers['x-forwarded-for']?.toString().split(',')[0] ||
      req.socket.remoteAddress ||
      ''
    );
  }
}
