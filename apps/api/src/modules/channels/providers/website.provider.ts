import { Injectable, Logger } from '@nestjs/common';
import { Channel } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { assertPublicHost } from '../../../common/ssrf-guard.util';
import { ChannelProvider, SendMessageResult, UserStatus } from './channel.provider.interface';

const VERIFY_TIMEOUT_MS = 8000;
const MAX_BODY_BYTES = 200_000; // тега в <head> достаточно найти в первых ~200KB

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

    const html = await this.fetchHtmlSafely(channel.websiteUrl);

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

  // Только чтение (HTTP GET + текстовый поиск) — никогда не бросает по сети мимо явных throw
  // выше, чтобы tryInitialize() (ChannelsService) получил ОДНО описательное сообщение, а не
  // голую сетевую ошибку без контекста.
  private async fetchHtmlSafely(rawUrl: string): Promise<string> {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new Error('Некорректный адрес сайта');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('Разрешены только http/https адреса');
    }

    await assertPublicHost(url.hostname);

    let response: Response;
    try {
      response = await fetch(url.toString(), {
        signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
        headers: { 'User-Agent': 'MWTRACK-WebsiteVerifier/1.0' },
      });
    } catch (error) {
      throw new Error(`Не удалось загрузить страницу: ${(error as Error).message}`);
    }

    // Повторная проверка ПОСЛЕ редиректов — response.url отражает финальный адрес,
    // который может резолвиться в другой (приватный) IP, чем исходный хост
    // (DNS-rebinding-через-редирект — исходной проверки assertPublicHost выше недостаточно).
    const finalUrl = new URL(response.url);
    await assertPublicHost(finalUrl.hostname);

    if (!response.ok) {
      throw new Error(`Сайт вернул ошибку ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) return '';
    let received = 0;
    let html = '';
    const decoder = new TextDecoder();
    while (received < MAX_BODY_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      html += decoder.decode(value, { stream: true });
    }
    await reader.cancel().catch(() => {});
    return html;
  }

  async sendMessage(): Promise<SendMessageResult> {
    return { success: false, error: 'У сайта нет канала для отправки сообщений' };
  }

  async getUserStatus(): Promise<UserStatus> {
    return { isReachable: false, isSubscribed: false };
  }
}
