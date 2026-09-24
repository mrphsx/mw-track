import { Injectable, Logger } from '@nestjs/common';
import { Channel } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { fetchPublicHtml } from '../../../common/safe-html-fetch.util';
import { ChannelProvider, SendMessageResult, UserStatus } from './channel.provider.interface';

// Обычный сайт без мессенджера вообще (ChannelType.WEBSITE, запрос пользователя 2026-09-03) —
// у Channel-строки нет своего API, но есть реальная задача — убедиться, что клиент правда
// поставил track.js на websiteUrl, прежде чем показывать канал "Активен". Это единственный
// провайдер, чей initialize() ходит по адресу, который ввёл сам клиент (не мы), — отсюда
// обязательная SSRF-защита (см. common/ssrf-guard.util.ts), которой ни один другой провайдер
// не требует (Telegram/WhatsApp/Instagram всегда ходят на адреса, которые контролируем мы).
// Client+Purchase для сайта создаются не через этот провайдер, а напрямую в TrackingService
// (см. Client.visitorId) — initialize() отвечает только за "isActive = скрипт реально стоит".
@Injectable()
export class WebsiteProvider implements ChannelProvider {
  private readonly logger = new Logger(WebsiteProvider.name);

  constructor(private prisma: PrismaService) {}

  async initialize(channel: Channel): Promise<void> {
    if (!channel.websiteUrl) {
      throw new Error('Укажите ссылку на сайт');
    }

    const project = await this.prisma.project.findUnique({
      where: { id: channel.projectId },
      select: { publicToken: true },
    });
    if (!project) throw new Error('Проект не найден');

    const html = await fetchPublicHtml(channel.websiteUrl, { userAgent: 'MWTRACK-WebsiteVerifier/1.0' });

    const cdnUrl = process.env.CDN_URL || '';
    const hasScriptTag = cdnUrl && html.includes(`${cdnUrl}/track.js`);
    const hasProjectId = html.includes(`data-project-id="${project.publicToken}"`);

    if (!hasScriptTag || !hasProjectId) {
      throw new Error('Скрипт не найден на странице — проверьте, что тег вставлен, и попробуйте снова');
    }

    // Иконка сайта для отображения в СРМ (запрос пользователя 2026-09-03) — та же html уже в
    // памяти (проверка тега выше), лишнего запроса не требуется. Best-effort: любая ошибка
    // здесь (нет тега, кривой href, сайт без фавиконки) не должна валить саму верификацию —
    // отсутствие иконки просто оставляет прежнее значение (или null), это не "Скрипт не найден".
    try {
      const faviconUrl = this.extractFaviconUrl(html, channel.websiteUrl);
      if (faviconUrl) {
        await this.prisma.channel.update({ where: { id: channel.id }, data: { websiteFaviconUrl: faviconUrl } });
      }
    } catch (error) {
      // Не пробрасываем — фавиконка необязательна для "Активен", но лог всё равно нужен
      // (аудит catch-блоков после инцидента 2026-08-06/07 — молчаливое поглощение ошибки
      // неотличимо от "всё в порядке").
      this.logger.warn(`Не удалось извлечь фавиконку для канала ${channel.id}: ${(error as Error).message}`);
    }
  }

  // Первый найденный <link rel="icon"|"shortcut icon"|"apple-touch-icon" href="..."> — простой
  // регэксп вместо полноценного HTML-парсера (та же логика, что уже используется для поиска
  // тега track.js выше — .includes()), достаточно для типичной разметки в <head>. Ищем все
  // <link>-теги отдельно (rel и href могут идти в любом порядке атрибутов), а не один regex на
  // rel+href подряд — иначе `<link href="..." rel="icon">` (href первым) не совпал бы.
  // Относительный href резолвится против websiteUrl (new URL(href, base) — поддерживает и
  // протокол-относительные, и абсолютные пути).
  private extractFaviconUrl(html: string, websiteUrl: string): string | null {
    const linkTags = html.match(/<link\b[^>]*>/gi) ?? [];
    for (const tag of linkTags) {
      if (!/rel=["'](?:shortcut icon|icon|apple-touch-icon)["']/i.test(tag)) continue;
      const hrefMatch = tag.match(/href=["']([^"']+)["']/i);
      if (!hrefMatch) continue;
      try {
        return new URL(hrefMatch[1], websiteUrl).toString();
      } catch {
        continue;
      }
    }
    return null;
  }

  async sendMessage(): Promise<SendMessageResult> {
    return { success: false, error: 'У сайта нет канала для отправки сообщений' };
  }

  async getUserStatus(): Promise<UserStatus> {
    return { isReachable: false, isSubscribed: false };
  }
}
