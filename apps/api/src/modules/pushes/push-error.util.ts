// Понятный текст ошибки отправки пуша (2026-10-26: «в списке ошибок пиши по-другому — просто сама
// ошибка и сколько людей под неё попали»). В PushLog.error лежит сырой ответ Telegram вида
// «Call to 'sendPhoto' failed! (400: Bad Request: chat not found)» — одна причина у разных методов
// отправки (фото/видео/текст) давала разные строки. Здесь сводим к одной человеческой причине.
const RULES: [RegExp, string][] = [
  [/chat not found/i, 'Чат не найден — клиент ни разу не запускал бота'],
  [/can'?t initiate conversation/i, 'Бот не может написать первым — клиент не нажимал «Старт»'],
  [/bot was blocked by the user|заблокировал бота/i, 'Клиент заблокировал бота'],
  [/user is deactivated/i, 'Аккаунт клиента удалён в Telegram'],
  [/can'?t parse entities/i, 'Ошибка разметки в тексте (незакрытый тег <b>, <i> и т.п.)'],
  [/caption is too long/i, 'Подпись к медиа длиннее 1024 символов'],
  [/message is too long/i, 'Текст длиннее 4096 символов'],
  [/button URL .* is invalid|BUTTON_URL_INVALID/i, 'Неверная ссылка в кнопке'],
  [/fetchAsInputFile|Bad Gateway|wrong file identifier|failed to get HTTP URL content/i, 'Не удалось загрузить медиа рассылки'],
  [/Too Many Requests|retry after|FLOOD/i, 'Лимит Telegram — слишком частая отправка'],
  [/Канал проекта не найден или неактивен/i, 'Бот проекта отключён'],
  [/Бот не инициализирован/i, 'Бот проекта не был запущен на сервере'],
  [/остановлено администратором|рассылка опоздала|устарела|прошло больше 48 часов/i, 'Не отправлено: рассылка опоздала или устарела'],
  [/отменена|уже завершена/i, 'Не отправлено: рассылка отменена или уже завершена'],
];

export function describePushError(raw: string | null): string {
  if (!raw) return 'Неизвестная ошибка';
  for (const [re, text] of RULES) if (re.test(raw)) return text;
  // Остальное — без технической обёртки «Call to 'x' failed! (400: …)».
  const m = raw.match(/^Call to '\w+' failed! \(\d+: (.*)\)$/s);
  return (m ? m[1] : raw).slice(0, 200);
}
