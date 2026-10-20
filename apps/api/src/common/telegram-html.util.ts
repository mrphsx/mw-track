// Проверка текста сообщения по правилам HTML-разметки Telegram Bot API (parse_mode: HTML) до
// отправки (запрос пользователя 2026-10-20). Раньше рассылка с лишним `</b>` уходила в очередь,
// и Telegram отклонял её у каждого получателя ("can't parse entities: Unexpected end tag"), —
// теперь такой текст не сохраняется и не отправляется, а автор сразу видит, что исправить.
//
// Тот же файл продублирован во фронтенде (apps/web/src/lib/telegram-html-validate.ts) для подсказки прямо
// в редакторе — правила должны меняться в обоих местах одновременно.

// Теги, которые понимает Telegram (https://core.telegram.org/bots/api#html-style).
const ALLOWED_TAGS = new Set([
  'b', 'strong', 'i', 'em', 'u', 'ins', 's', 'strike', 'del',
  'span', 'tg-spoiler', 'a', 'tg-emoji', 'code', 'pre', 'blockquote',
]);

// Лимиты Telegram на длину видимого текста (после удаления тегов и раскрытия сущностей).
export const TELEGRAM_TEXT_LIMIT = 4096;
export const TELEGRAM_CAPTION_LIMIT = 1024;

const NAMED_ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"' };

export interface TelegramHtmlCheck {
  error: string | null;
  // Видимый текст без тегов — для проверки длины.
  plainText: string;
}

export function checkTelegramHtml(html: string): TelegramHtmlCheck {
  const stack: string[] = [];
  let plain = '';
  let i = 0;
  while (i < html.length) {
    const ch = html[i];
    if (ch === '<') {
      const end = html.indexOf('>', i);
      if (end === -1) {
        return fail(`Символ «<» не закрыт. Если нужен сам знак, напишите &lt;`, i);
      }
      const raw = html.slice(i + 1, end).trim();
      const closing = raw.startsWith('/');
      const body = closing ? raw.slice(1).trim() : raw;
      const nameMatch = /^([a-zA-Z][a-zA-Z0-9-]*)/.exec(body);
      if (!nameMatch) {
        return fail(`Непонятная метка «<${raw}>». Если нужен знак «<», напишите &lt;`, i);
      }
      const name = nameMatch[1].toLowerCase();
      if (!ALLOWED_TAGS.has(name)) {
        return fail(`Telegram не поддерживает метку <${name}>. Можно: <b>, <i>, <u>, <s>, <a href="...">, <code>, <pre>, <blockquote>, <tg-spoiler>`, i);
      }
      if (closing) {
        const top = stack[stack.length - 1];
        if (top === undefined) {
          return fail(`Лишняя закрывающая метка </${name}> — для неё нет открывающей <${name}>`, i);
        }
        if (top !== name) {
          return fail(`Метки перепутаны: открыта <${top}>, а закрывается </${name}>. Сначала закройте </${top}>`, i);
        }
        stack.pop();
      } else {
        const attrs = body.slice(name.length);
        if (name === 'a' && !/href\s*=\s*("[^"]*"|'[^']*'|[^\s"']+)/i.test(attrs)) {
          return fail(`У ссылки <a> нет адреса: нужно <a href="https://...">текст</a>`, i);
        }
        if (name === 'span' && !/class\s*=\s*["']?tg-spoiler/i.test(attrs)) {
          return fail(`Метка <span> работает только как спойлер: <span class="tg-spoiler">`, i);
        }
        if (name === 'tg-emoji' && !/emoji-id\s*=/i.test(attrs)) {
          return fail(`У метки <tg-emoji> нет emoji-id`, i);
        }
        stack.push(name);
      }
      i = end + 1;
      continue;
    }
    // Одиночные «>» и «&» (не начало сущности) Telegram на практике принимает — ни одна из
    // наших рассылок на них не падала, а «5 > 3» или «Tom & Jerry» встречаются в живых текстах.
    // Ошибки разбора у нас были только из-за меток — их и проверяем строго.
    if (ch === '&') {
      const m = /^&(#\d+|#x[0-9a-fA-F]+|[a-zA-Z]+);/.exec(html.slice(i, i + 12));
      if (!m) {
        plain += ch;
        i++;
        continue;
      }
      const ent = m[1];
      if (ent.startsWith('#')) {
        const code = ent[1] === 'x' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
        plain += Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '?';
      } else if (NAMED_ENTITIES[ent.toLowerCase()] !== undefined) {
        plain += NAMED_ENTITIES[ent.toLowerCase()];
      } else {
        return fail(`Telegram не понимает «&${ent};». Если нужен сам знак «&», напишите &amp;`, i);
      }
      i += m[0].length;
      continue;
    }
    plain += ch;
    i++;
  }
  if (stack.length > 0) {
    const open = stack[stack.length - 1];
    return { error: `Метка <${open}> не закрыта — добавьте </${open}>`, plainText: plain };
  }
  return { error: null, plainText: plain };

  function fail(message: string, pos: number): TelegramHtmlCheck {
    const near = html.slice(Math.max(0, pos - 15), pos + 25).replace(/\s+/g, ' ');
    return { error: `${message} (рядом с «${near}»)`, plainText: plain };
  }
}

// Ошибка или null. hasMedia — текст уйдёт подписью к фото/видео/альбому (лимит 1024, а не 4096).
// Подстановки {first_name} и т.п. длину почти не меняют, проверяем шаблон как есть.
export function validateTelegramMessage(html: string, hasMedia: boolean): string | null {
  const { error, plainText } = checkTelegramHtml(html);
  if (error) return error;
  const limit = hasMedia ? TELEGRAM_CAPTION_LIMIT : TELEGRAM_TEXT_LIMIT;
  const length = [...plainText].length;
  if (length > limit) {
    return hasMedia
      ? `Текст под фото/видео слишком длинный: ${length} символов, Telegram разрешает до ${limit}. Сократите текст или отправьте без медиа.`
      : `Текст слишком длинный: ${length} символов, Telegram разрешает до ${limit}.`;
  }
  return null;
}

// Подставляемые значения (имя, username) идут внутрь HTML — экранируем, иначе имя вроде
// «Ana <3» ломает разбор сообщения у этого получателя.
export function escapeTelegramHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
