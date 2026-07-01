import * as fs from 'fs/promises';
import * as path from 'path';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Landing, Project, TelegramMode, TrackingPixel } from '@prisma/client';
import { Request, Response } from 'express';
import { nanoid } from 'nanoid';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { StorageService } from './storage.service';
import { matchDomainPath } from '../domains/domain-path.util';

const START_CODE_TTL_SECONDS = 24 * 60 * 60;

type LandingChannel = {
  tgMode: TelegramMode | null;
  tgBotUsername: string | null;
  tgChannelUsername: string | null;
  tgPersonalUsername: string | null;
};

type ProjectWithLandingData = Project & {
  channels: LandingChannel[];
  pixels: TrackingPixel[]; // проект не привязан к платформе — пикселей любых платформ может быть несколько
};

@Injectable()
export class LandingRendererService {
  private readonly logger = new Logger(LandingRendererService.name);
  private readonly templatesDir = path.join(__dirname, 'templates');

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private storage: StorageService,
  ) {}

  // Один домен -> много лендингов/проектов через путь (2026-06-29, DomainPath) — вызывается
  // из InternalController.serveByDomain на КАЖДЫЙ запрос к клиентскому домену (Nginx больше не
  // знает про лендинги, см. NginxService.renderTarget). fullPath — полный путь запроса с
  // ведущим "/", без query string. Голый домен без явного маппинга пути (включая "/") отдаёт
  // 404 — раньше Domain.landingId неявно отдавал контент на корне для любого домена.
  async renderByDomain(host: string, fullPath: string, req: Request, res: Response): Promise<void> {
    const bareHost = host.replace(/^www\./, '').toLowerCase();
    const domain = await this.prisma.domain.findFirst({ where: { domain: bareHost, status: 'ACTIVE' } });
    if (!domain) {
      res.status(404).send('<h1>Page not found</h1>');
      return;
    }

    const paths = await this.prisma.domainPath.findMany({ where: { domainId: domain.id } });
    const resolved = matchDomainPath(paths, fullPath);
    if (!resolved) {
      res.status(404).send('<h1>Page not found</h1>');
      return;
    }

    await this.renderAndServe(resolved.landingId, resolved.subPath, req, res);
  }

  // subPath — запрошенный путь внутри лендинга после landingId (см. InternalController):
  // '' для корня (index.html у CUSTOM), 'style.css'/'img/logo.png' и т.п. для остальных
  // ассетов CUSTOM-лендинга. Для TEMPLATE игнорируется — там всегда одна страница.
  async renderAndServe(landingId: string, subPath: string, req: Request, res: Response): Promise<void> {
    const landing = await this.prisma.landing.findUnique({
      where: { id: landingId },
      include: {
        project: {
          include: {
            // orderBy:createdAt desc — последний подключённый Telegram-канал должен сразу
            // стать тем, на который ведёт лендинг (без этого Prisma даёт неопределённый порядок
            // при take:1, и новый канал мог бы не подхватиться сразу после добавления).
            channels: { where: { type: 'TELEGRAM', isActive: true }, orderBy: { createdAt: 'desc' }, take: 1 },
            pixels: { where: { isActive: true } },
          },
        },
      },
    });

    if (!landing || landing.status !== 'PUBLISHED' || landing.deletedAt) {
      res.status(404).send('<h1>Page not found</h1>');
      return;
    }

    if (landing.type === 'CUSTOM') {
      await this.serveCustomFile(landing as Landing & { project: ProjectWithLandingData }, subPath, req, res);
      return;
    }

    // EXTERNAL (внешний сервер клиента) — отдельный шаг 2.4, не реализуется здесь.
    if (landing.type !== 'TEMPLATE') {
      res.status(404).send('<h1>Landing type not supported yet</h1>');
      return;
    }

    let html = await this.renderTemplate(landing as Landing & { project: ProjectWithLandingData });
    html = await this.injectTrackingScripts(html, landing.project, req);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store');
    this.removeRestrictiveCsp(res);
    res.send(html);
  }

  // helmet() в main.ts ставит на КАЖДЫЙ ответ api default CSP (script-src 'self') —
  // разумно для своих JSON-эндпоинтов, но лендинги по дизайну грузят сторонние скрипты
  // с другого origin (CDN_URL — apps/sdk/track.js, плюс FB/TikTok pixel, Cloudflare beacon
  // и т.п. у клиентов) — 'self' блокирует их все молча (ошибка видна только в консоли
  // браузера посетителя). У публичных лендингов нет sessions/cookies этого API, которые
  // CSP защищала бы — снимаем заголовок только здесь, не трогая остальной API.
  private removeRestrictiveCsp(res: Response): void {
    res.removeHeader('Content-Security-Policy');
  }

  // Отдаёт index.html (с инжектом трекинга) либо произвольный ассет CUSTOM-лендинга из MinIO.
  private async serveCustomFile(
    landing: Landing & { project: ProjectWithLandingData },
    subPath: string,
    req: Request,
    res: Response,
  ): Promise<void> {
    const isIndex = !subPath || subPath === 'index.html';
    const key = `${landing.customBasePath}/${isIndex ? 'index.html' : subPath}`;

    try {
      if (isIndex) {
        const buffer = await this.storage.getObjectBuffer(key);
        const html = await this.injectTrackingScripts(buffer.toString('utf-8'), landing.project, req);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-store');
        this.removeRestrictiveCsp(res);
        res.send(html);
        return;
      }

      const stream = await this.storage.getObjectStream(key);
      res.type(path.extname(key) || '.bin');
      stream.on('error', () => {
        if (!res.headersSent) res.status(404).send('Not found');
      });
      stream.pipe(res);
    } catch (error) {
      this.logger.warn(`serveCustomFile failed for ${key}: ${(error as Error).message}`);
      res.status(404).send(isIndex ? '<h1>Page not found</h1>' : 'Not found');
    }
  }

  async renderPreviewHtml(landingId: string, companyId: string): Promise<string> {
    const landing = await this.prisma.landing.findFirst({
      where: { id: landingId, companyId, deletedAt: null },
      include: {
        project: {
          include: {
            // orderBy:createdAt desc — последний подключённый Telegram-канал должен сразу
            // стать тем, на который ведёт лендинг (без этого Prisma даёт неопределённый порядок
            // при take:1, и новый канал мог бы не подхватиться сразу после добавления).
            channels: { where: { type: 'TELEGRAM', isActive: true }, orderBy: { createdAt: 'desc' }, take: 1 },
            pixels: { where: { isActive: true } },
          },
        },
      },
    });
    if (!landing) throw new NotFoundException('Лендинг не найден');

    if (landing.type === 'CUSTOM') {
      if (!landing.customBasePath) throw new NotFoundException('Лендинг ещё не загружен');
      const buffer = await this.storage.getObjectBuffer(`${landing.customBasePath}/index.html`);
      return buffer.toString('utf-8');
    }

    if (landing.type !== 'TEMPLATE') throw new NotFoundException('Предпросмотр пока не поддержан для этого типа лендинга');

    return this.renderTemplate(landing as Landing & { project: ProjectWithLandingData });
  }

  private async renderTemplate(landing: Landing & { project: ProjectWithLandingData }): Promise<string> {
    const templatePath = path.join(this.templatesDir, landing.templateId!, 'template.html');
    let html = await fs.readFile(templatePath, 'utf-8');

    const data = (landing.templateData as Record<string, string>) || {};
    const channel = landing.project.channels?.[0];
    const tgLink = this.buildTelegramLink(channel);

    const vars: Record<string, string> = {
      ...data,
      META_TITLE: landing.metaTitle || data.CHANNEL_TITLE || 'Закрытый канал',
      META_DESCRIPTION: landing.metaDescription || data.CHANNEL_DESCRIPTION || '',
      // BOT_USERNAME управляет data-tg-bot в шаблоне (см. apps/sdk/src/browser.ts) — SDK
      // перехватывает клик и пересобирает ссылку со свежим start-кодом ТОЛЬКО если этот
      // атрибут непустой; для прямых режимов (канал/личка) он пустой намеренно, чтобы
      // ссылка из TG_LINK сработала как обычный переход без лишнего async-запроса.
      BOT_USERNAME: tgLink.isBotMediated ? channel?.tgBotUsername || '' : '',
      TG_LINK: tgLink.url,
      START_CODE: '{{START_CODE}}', // заменяется позже, в injectTrackingScripts
      CHANNEL_INITIAL: (data.CHANNEL_TITLE || 'C').charAt(0).toUpperCase(),
    };

    html = this.processConditionals(html, vars);

    for (const [key, value] of Object.entries(vars)) {
      html = html.replaceAll(`{{${key}}}`, value || '');
    }

    return html;
  }

  // 4 способа, которыми лендинг ведёт в Telegram (TelegramMode, см. prisma/schema.prisma):
  // BOT_DIRECT/PRIVATE_CHANNEL_REQUEST — деeп-линк на бота (атрибуция полная, у invite-ссылок
  // каналов нет query-параметров, поэтому приватный режим тоже идёт через бота — дальше сам
  // бот вручает invite-ссылку, см. TelegramProvider.handleStart); PUBLIC_CHANNEL_DIRECT/
  // PERSONAL_DM — статичная прямая ссылка на канал/личный аккаунт, без бота, без async.
  // isBotMediated решает, рисовать ли data-tg-bot в шаблоне (включает SDK-перехват клика).
  private buildTelegramLink(channel: LandingChannel | undefined): { url: string; isBotMediated: boolean } {
    if (!channel) return { url: '', isBotMediated: false };

    switch (channel.tgMode) {
      case 'PUBLIC_CHANNEL_DIRECT':
        return { url: channel.tgChannelUsername ? `https://t.me/${channel.tgChannelUsername.replace(/^@/, '')}` : '', isBotMediated: false };
      case 'PERSONAL_DM':
        return { url: channel.tgPersonalUsername ? `https://t.me/${channel.tgPersonalUsername.replace(/^@/, '')}` : '', isBotMediated: false };
      case 'PRIVATE_CHANNEL_REQUEST':
      case 'BOT_DIRECT':
      default:
        return { url: channel.tgBotUsername ? `https://t.me/${channel.tgBotUsername}?start={{START_CODE}}` : '', isBotMediated: true };
    }
  }

  // Дока обрабатывала только if-без-else, но шаблон minimal использует конструкцию с else —
  // без её поддержки фолбэк-ветка либо терялась, либо попадала в HTML как текст.
  private processConditionals(html: string, vars: Record<string, string>): string {
    return html.replace(
      /\{\{#if (\w+)\}\}([\s\S]*?)(?:\{\{else\}\}([\s\S]*?))?\{\{\/if\}\}/g,
      (_match, varName: string, ifContent: string, elseContent = '') => (vars[varName] ? ifContent : elseContent),
    );
  }

  private async injectTrackingScripts(html: string, project: ProjectWithLandingData, req: Request): Promise<string> {
    const startCode = nanoid(16);

    const urlParams = new URLSearchParams(req.query as Record<string, string>);
    const trackingData = {
      fbclid: urlParams.get('fbclid'),
      ttclid: urlParams.get('ttclid'),
      utmSource: urlParams.get('utm_source'),
      utmMedium: urlParams.get('utm_medium'),
      utmCampaign: urlParams.get('utm_campaign'),
      utmContent: urlParams.get('utm_content'),
      ip: this.getClientIp(req),
      userAgent: req.headers['user-agent'],
      landingUrl: req.url,
    };

    await this.redis.set(`start:${startCode}`, JSON.stringify(trackingData), 'EX', START_CODE_TTL_SECONDS);

    html = html.replaceAll('{{START_CODE}}', startCode);

    // Проект не привязан к одной платформе — пикселей одной и той же платформы
    // может быть несколько (несколько FB-аккаунтов и т.п.), поэтому ниже цикл,
    // а не одно фиксированное fbPixelId/ttPixelId.
    const fbPixels = project.pixels.filter((p) => p.platform === 'FACEBOOK');
    const ttPixels = project.pixels.filter((p) => p.platform === 'TIKTOK');

    const trackingScripts = `
<script src="${process.env.CDN_URL}/track.js"
        data-project-id="${project.publicToken}"
        data-api-url="${process.env.API_URL}/api/v1"
        async></script>
${
  fbPixels.length > 0
    ? `
<!-- Facebook Pixel -->
<script>
!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window,document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
${fbPixels.map((p) => `fbq('init','${p.pixelId}');`).join('\n')}
fbq('track','PageView',{eventID:'${nanoid(16)}'});
</script>
${fbPixels
  .map(
    (p) =>
      `<noscript><img height="1" width="1" style="display:none" src="https://www.facebook.com/tr?id=${p.pixelId}&ev=PageView&noscript=1"/></noscript>`,
  )
  .join('\n')}`
    : ''
}
${
  ttPixels.length > 0
    ? `
<!-- TikTok Pixel -->
<script>
!function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];
ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"];
ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};
for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);
ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e};
ttq.load=function(e,n){var i="https://analytics.tiktok.com/i18n/pixel/events.js",o=document.createElement("script");
o.type="text/javascript";o.async=!0;o.src=i+"?sdkid="+e+"&lib="+t;
var a=document.getElementsByTagName("script")[0];a.parentNode.insertBefore(o,a)};
${ttPixels.map((p) => `ttq.load('${p.pixelId}');`).join('\n')}
ttq.page();}(window,document,'ttq');
</script>`
    : ''
}`;

    if (html.includes('</head>')) {
      html = html.replace('</head>', `${trackingScripts}\n</head>`);
    } else if (html.includes('<!-- TRACKING_PLACEHOLDER -->')) {
      html = html.replace('<!-- TRACKING_PLACEHOLDER -->', trackingScripts);
    } else {
      html = trackingScripts + html;
    }

    return html;
  }

  private getClientIp(req: Request): string {
    return (
      (req.headers['cf-connecting-ip'] as string) ||
      (req.headers['x-real-ip'] as string) ||
      req.socket.remoteAddress ||
      ''
    );
  }
}
