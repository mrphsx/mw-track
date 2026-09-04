// Вынесено из LandingRendererService (запрос пользователя 2026-08-31, персональная invite-ссылка
// НА ВИЗИТ) — нужен теперь и в TrackingService (для решения, стоит ли тратить Telegram
// API-вызов на создание одноразовой invite-ссылки при /tg-redirect), а TrackingModule
// сознательно не тянет LandingsModule (см. комментарий в telegram-link.util.ts про ту же
// причину) — общая dependency-free утилита вместо циклического импорта.
//
// Баг-репорт пользователя 2026-07-29: "наши events не попадают в фейсбук" — реальная причина
// (не отсутствие полей, а испорченные данные): Facebook САМ сканирует ссылку на лендинг
// краулером-препросмотрщиком (facebookexternalhit) почти на каждый показ/клик объявления —
// его визит попадал в тот же landing-visit-country/landing-visit-attribution:<landingId> кэш
// (общий на весь лендинг, "последний визит побеждает" — осознанное упрощение) и почти всегда
// оказывался ПОСЛЕДНИМ перед реальным вступлением в приватный канал: живые Subscribe/Dialogue
// массово уходили в Facebook с IP/User-Agent самого Facebook (2a03:2880::/32,
// "facebookexternalhit/1.1...") вместо настоящего посетителя, без fbclid/fbp вообще (краулер не
// кликает по рекламе и не выполняет JS) — набор данных, который сам Facebook не может
// сопоставить ни с одним реальным пользователем. Список — известные краулеры/боты предпросмотра
// ссылок (не только Facebook — тот же класс проблемы возможен и от WhatsApp/Telegram/Slack/
// Discord и т.п. ботов).
const BOT_USER_AGENT_PATTERN =
  /bot|crawl|spider|facebookexternalhit|whatsapp|telegrambot|slackbot|discordbot|linkedinbot|googlebot|bingbot|duckduckbot|baiduspider|yandexbot|applebot|skypeuripreview|vkshare|redditbot|pinterest|ia_archiver|semrushbot|ahrefsbot/i;

export function isBotUserAgent(userAgent: string | undefined): boolean {
  return !!userAgent && BOT_USER_AGENT_PATTERN.test(userAgent);
}
