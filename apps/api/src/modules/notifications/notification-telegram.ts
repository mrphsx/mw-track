import { readFile } from 'fs/promises';
import * as path from 'path';
import { Api, GrammyError } from 'grammy';

// Тонкая обёртка над Bot API для бота оповещений. Намеренно без grammY Bot и без карты живых
// инстансов, как у TelegramProvider: этот бот только отвечает на /start и шлёт уведомления,
// ему не нужны middleware, сессии и обработчики апдейтов — только четыре метода API.
// Аватарка MWTRACK для бота оповещений (2026-10-26: «когда кто-то привяжет своего бота, к нему тоже
// должна примениться аватарка, как у нас»). Файл — снятая с нашего бота версия, которую владелец
// подрезал под круг аватарки; лежит в apps/api/assets (вне src, одинаково видна из dist и dist-build).
const NOTIFIER_AVATAR_PATH = path.resolve(__dirname, '../../../assets/notifier-bot-avatar.jpg');

// Прямой multipart-запрос: setMyProfilePhoto новее, чем установленная версия grammY.
export async function setNotifierAvatar(token: string): Promise<void> {
  const photo = await readFile(NOTIFIER_AVATAR_PATH);
  const form = new FormData();
  form.append('photo', JSON.stringify({ type: 'static', photo: 'attach://avatar' }));
  form.append('avatar', new Blob([photo], { type: 'image/jpeg' }), 'avatar.jpg');
  const res = (await (await fetch(`https://api.telegram.org/bot${token}/setMyProfilePhoto`, { method: 'POST', body: form })).json()) as {
    ok: boolean;
    description?: string;
  };
  if (!res.ok) throw new Error(res.description ?? 'Telegram не принял аватарку');
}

// Кнопка «Открыть CRM» у поля ввода бота — открывает мини-апп CRM (2026-10-26). Идемпотентно.
export async function setMiniAppMenuButton(token: string, url: string): Promise<void> {
  await notifierApi(token).setChatMenuButton({ menu_button: { type: 'web_app', text: 'Открыть CRM', web_app: { url } } });
}

export function notifierApi(token: string): Api {
  return new Api(token);
}

export type TelegramSendFailure =
  // Получатель заблокировал бота или удалил чат — слать дальше бессмысленно до нового /start.
  | 'RECIPIENT_UNREACHABLE'
  // Токен отозван в @BotFather — бот компании больше не работает вообще.
  | 'BOT_UNAUTHORIZED'
  // Сеть, 429, 5xx — имеет смысл повторить.
  | 'RETRYABLE';

export function classifyTelegramError(error: unknown): TelegramSendFailure {
  if (error instanceof GrammyError) {
    if (error.error_code === 401) return 'BOT_UNAUTHORIZED';
    if (error.error_code === 403) return 'RECIPIENT_UNREACHABLE';
    if (error.error_code === 400 && /chat not found|user not found|PEER_ID_INVALID/i.test(error.description)) {
      return 'RECIPIENT_UNREACHABLE';
    }
  }
  return 'RETRYABLE';
}

export function describeTelegramError(error: unknown): string {
  if (error instanceof GrammyError) return `${error.error_code}: ${error.description}`;
  return error instanceof Error ? error.message : String(error);
}

// Текущие юзернейм и имя собеседника. Приходят бесплатно в ответе на sendMessage (у сообщения
// есть объект chat) и в каждом входящем апдейте — отдельный запрос за ними не нужен.
export interface ChatProfile {
  username: string | null;
  firstName: string | null;
}

export function profileFromChat(chat: { type: string; username?: string; first_name?: string } | undefined): ChatProfile | null {
  if (!chat || chat.type !== 'private') return null;
  return { username: chat.username ?? null, firstName: chat.first_name ?? null };
}

// replyMarkup — кнопки бота (клавиатура меню, кнопки мини-аппа), 2026-10-26.
export async function sendNotifierMessage(token: string, chatId: string, html: string, replyMarkup?: unknown): Promise<ChatProfile | null> {
  const message = await notifierApi(token).sendMessage(chatId, html, {
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    ...(replyMarkup ? { reply_markup: replyMarkup as never } : {}),
  });
  return profileFromChat(message.chat);
}

// Фоновая сверка для тех, кому давно ничего не отправляли. getChat по id работает для частного
// чата, который пользователь уже открыл с ботом; по @username для частных лиц — нет.
export async function fetchChatProfile(token: string, chatId: string): Promise<ChatProfile | null> {
  const chat = await notifierApi(token).getChat(chatId);
  return profileFromChat(chat);
}
