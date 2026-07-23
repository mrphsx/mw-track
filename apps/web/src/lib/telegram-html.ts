// Рендер текста пуша в предпросмотре так, как его реально покажет Telegram (parse_mode: 'HTML',
// см. TelegramProvider.sendMessage) — запрос пользователя 2026-07-17: "html разметка точно не
// работает в предпросмотре" (раньше текст просто выводился как есть, React экранировал теги,
// и предпросмотр показывал буквально "<b>жирный</b>" вместо жирного текста).
//
// Экранируем всё, затем избирательно "распечатываем" только тот подмножество тегов, которое
// Telegram Bot API реально поддерживает в HTML-режиме — это одновременно и белый список для
// безопасности (dangerouslySetInnerHTML на сырой ввод иначе было бы XSS-дырой), и точное
// соответствие тому, что покажет Telegram (неподдерживаемые теги останутся видны как текст,
// как и было бы в реальном сообщении).
const SIMPLE_TAGS = ['b', 'strong', 'i', 'em', 'u', 'ins', 's', 'strike', 'del', 'code', 'pre'];

export function renderTelegramHtml(text: string): string {
  let escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const simpleTagPattern = new RegExp(`&lt;(/?)(${SIMPLE_TAGS.join('|')})&gt;`, 'gi');
  escaped = escaped.replace(simpleTagPattern, (_match, closing, tag) => `<${closing}${tag.toLowerCase()}>`);

  // <a href="..."> — только http(s)-ссылки, атрибут не тронут экранированием выше (кавычки не
  // экранируются, действие тегов только < и >).
  escaped = escaped.replace(
    /&lt;a href="(https?:\/\/[^"&]*)"&gt;/gi,
    '<a href="$1" target="_blank" rel="noopener noreferrer">',
  );
  escaped = escaped.replace(/&lt;\/a&gt;/gi, '</a>');

  return escaped.replace(/\n/g, '<br>');
}
