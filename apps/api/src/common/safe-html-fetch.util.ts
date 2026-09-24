import { assertPublicHost } from './ssrf-guard.util';

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_BYTES = 200_000; // тега в <head> достаточно найти в первых ~200KB
const DEFAULT_USER_AGENT = 'MWTRACK-Verifier/1.0';

// Вынесено из WebsiteProvider.fetchHtmlSafely (запрос пользователя 2026-09-07, "внешний
// лендинг" — та же самая задача: сходить по адресу, который ввёл сам клиент-арендатор, не мы, и
// вернуть его HTML). SSRF-защита должна жить в ОДНОМ месте, не дублироваться на каждый новый
// случай "сходить по чужому URL" — в отличие от decodeAdMacro в другом месте этой кодовой базы
// (сознательно НЕ шарится между вызывающими из-за своей хрупкой истории багов), здесь риск
// обратный: два независимых, чуть разошедшихся копии кода с сетевыми проверками безопасности —
// это плохо само по себе, портит единственный источник истины по тому, что вообще разрешено.
// Только чтение (HTTP GET + текст) — никогда не бросает по сети мимо явных throw ниже, чтобы
// вызывающий (WebsiteProvider.initialize/LandingsService.verifyExternalLanding) получил ОДНО
// описательное сообщение, а не голую сетевую ошибку без контекста.
export async function fetchPublicHtml(
  rawUrl: string,
  opts?: { timeoutMs?: number; maxBytes?: number; userAgent?: string },
): Promise<string> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = opts?.maxBytes ?? DEFAULT_MAX_BYTES;
  const userAgent = opts?.userAgent ?? DEFAULT_USER_AGENT;

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
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'User-Agent': userAgent },
    });
  } catch (error) {
    throw new Error(`Не удалось загрузить страницу: ${(error as Error).message}`);
  }

  // Повторная проверка ПОСЛЕ редиректов — response.url отражает финальный адрес, который может
  // резолвиться в другой (приватный) IP, чем исходный хост (DNS-rebinding-через-редирект —
  // исходной проверки assertPublicHost выше недостаточно).
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
  while (received < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    html += decoder.decode(value, { stream: true });
  }
  await reader.cancel().catch(() => {});
  return html;
}
