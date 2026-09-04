import { ChannelType, TelegramMode } from '@prisma/client';

// Чистая функция без DI — используется и из LandingRendererService (рендер шаблона), и из
// TrackingController (редирект-эндпоинт /track/:publicToken/tg-redirect). Вынесена сюда, а не
// метод одного из сервисов, чтобы TrackingModule не тянул LandingsModule (аналогично
// domain-path.util.ts в модуле domains — та же причина, избежать циклической зависимости).
export interface TelegramLinkChannel {
  type: ChannelType;
  tgMode: TelegramMode | null;
  tgBotUsername: string | null;
  tgChannelUsername: string | null;
  tgPersonalUsername: string | null;
  tgInviteLink: string | null;
  // Обычный сайт (ChannelType.WEBSITE, запрос пользователя 2026-09-03) — не используется этим
  // файлом (buildTelegramLink/buildTelegramHttpsLink оба гейтятся type!=='TELEGRAM'), нужен
  // только для структурной совместимости с LandingRendererService.ProjectWithLandingData,
  // которая переиспользует этот интерфейс для типа project.channel целиком.
  websiteUrl?: string | null;
}

// Все 4 режима отдают схему tg:// (не https://t.me/...) — обычная https-ссылка на t.me
// открывает веб-интерстишл САМОГО Telegram, а tg:// браузер/ОС перехватывают сразу нативным
// попапом "Открыть в Telegram?", без какой-либо промежуточной страницы (см. запрос
// пользователя 2026-07-02). startCode нужен только для BOT_DIRECT — код донесённой через
// /track/:publicToken/tg-redirect?code=<code> атрибуции (fbclid/ttclid/utm), тот же
// одноразовый Redis start:<code>, который читает TelegramProvider.handleStart.
// landingInviteLink — персональная invite-ссылка КОНКРЕТНОГО лендинга (Landing.tgInviteLink),
// для точной пер-лендинговой атрибуции подписчиков (TelegramProvider.handleJoinRequest
// сверяет, через какую именно ссылку пришла заявка). Если не передана (лендинг ещё не
// публиковался с этой фичи, либо канал в другом режиме) — используется общая ссылка канала
// (channel.tgInviteLink) как fallback, ровно как раньше.
export function buildTelegramLink(channel: TelegramLinkChannel | null, startCode?: string, landingInviteLink?: string | null): string {
  if (!channel || channel.type !== 'TELEGRAM') return '';

  switch (channel.tgMode) {
    case 'PUBLIC_CHANNEL_DIRECT':
      return channel.tgChannelUsername ? `tg://resolve?domain=${channel.tgChannelUsername.replace(/^@/, '')}` : '';
    case 'PERSONAL_DM': {
      if (!channel.tgPersonalUsername) return '';
      const domain = channel.tgPersonalUsername.replace(/^@/, '');
      // &text= предзаполняет (не отправляет!) сообщение собеседнику — лучшее из возможного
      // для атрибуции лендинга в PERSONAL_DM, т.к. tg://resolve никогда не проходит через наш
      // сервер (в отличие от BOT_DIRECT, где &start= долетает как аргумент команды /start).
      // Честное ограничение: код виден посетителю и может быть стёрт до отправки — тогда
      // просто теряется атрибуция этого диалога, TelegramPersonalService всё равно заведёт
      // клиента по первому сообщению (см. запрос пользователя 2026-07-04, диалоги).
      return startCode ? `tg://resolve?domain=${domain}&text=${encodeURIComponent(startCode)}` : `tg://resolve?domain=${domain}`;
    }
    case 'PRIVATE_CHANNEL_REQUEST': {
      const inviteLink = landingInviteLink || channel.tgInviteLink;
      return inviteLink ? toTgInviteScheme(inviteLink) : '';
    }
    case 'BOT_DIRECT':
    default:
      if (!channel.tgBotUsername) return '';
      return startCode ? `tg://resolve?domain=${channel.tgBotUsername}&start=${startCode}` : `tg://resolve?domain=${channel.tgBotUsername}`;
  }
}

// https://t.me/... эквивалент buildTelegramLink выше (запрос пользователя 2026-08-31, "возьмём
// у конкурента полезные наработки" — их Android-эскейп строит intent прямо в приложение
// Telegram с S.browser_fallback_url=<https>, на случай если Telegram не установлен). Тот же
// switch по режимам, что и у tg://-версии, только конечная схема другая — обе версии одной
// ссылки нужны одновременно (см. TrackingController.tgRedirect, ?format=json).
export function buildTelegramHttpsLink(channel: TelegramLinkChannel | null, startCode?: string, landingInviteLink?: string | null): string {
  if (!channel || channel.type !== 'TELEGRAM') return '';

  switch (channel.tgMode) {
    case 'PUBLIC_CHANNEL_DIRECT':
      return channel.tgChannelUsername ? `https://t.me/${channel.tgChannelUsername.replace(/^@/, '')}` : '';
    case 'PERSONAL_DM': {
      if (!channel.tgPersonalUsername) return '';
      const domain = channel.tgPersonalUsername.replace(/^@/, '');
      return startCode ? `https://t.me/${domain}?text=${encodeURIComponent(startCode)}` : `https://t.me/${domain}`;
    }
    case 'PRIVATE_CHANNEL_REQUEST': {
      // Уже https://t.me/+HASH в исходном виде — та самая ссылка, которую toTgInviteScheme
      // выше конвертирует в tg://, здесь конвертировать не нужно вообще.
      return landingInviteLink || channel.tgInviteLink || '';
    }
    case 'BOT_DIRECT':
    default:
      if (!channel.tgBotUsername) return '';
      return startCode ? `https://t.me/${channel.tgBotUsername}?start=${startCode}` : `https://t.me/${channel.tgBotUsername}`;
  }
}

// Channel.tgInviteLink хранится как обычная https://t.me/+HASH (или устаревший
// .../joinchat/HASH) — это ровно то, что возвращает bot.api.createChatInviteLink
// (см. TelegramProvider.initialize) и что удобно отдавать как fallback-ссылку боту
// (handleStart). Для самого лендинга/редиректа нужен tg://join?invite=HASH — тот же hash.
function toTgInviteScheme(inviteLink: string): string {
  const hash = extractInviteHash(inviteLink);
  return hash ? `tg://join?invite=${hash}` : inviteLink;
}

// Общий hash-суффикс https://t.me/+HASH / .../joinchat/HASH invite-ссылки — вынесен отдельно
// от toTgInviteScheme (запрос пользователя 2026-08-31, персональная invite-ссылка НА ВИЗИТ), т.к.
// теперь нужен и для построения tg://-ссылки, и как ключ Redis-кэша атрибуции этой конкретной
// ссылки (TelegramProvider.createOneTimeInviteLink/handleJoinRequest) — единый источник разбора.
export function extractInviteHash(inviteLink: string): string | null {
  const match = inviteLink.match(/t\.me\/(?:\+|joinchat\/)([\w-]+)/);
  return match ? match[1] : null;
}
