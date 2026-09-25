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
// Расширено 2026-09-25 (запрос пользователя: "проверь ещё раз чтобы все правила были
// максимально правильный и широкие... не только мета боты") — разбор реального трафика одного
// продовского лендинга подтвердил: подавляющее большинство "ботов" там были не абстрактной
// угрозой, а собственным краулером Meta (`facebookexternalhit` + официальный `meta-externalads`,
// см. https://developers.facebook.com/docs/sharing/webmasters/crawler) — но список ниже намеренно
// не ограничен только рекламными площадками. Общий catch-all `bot|crawl|spider` уже сам по себе
// ловит подавляющее большинство официально названных краулеров (GPTBot, ClaudeBot,
// PerplexityBot, Amazonbot, PetalBot, MJ12bot, DotBot, Bytespider, AdsBot-Google и т.п. — у всех
// в названии есть "bot" или "spider"), явные googlebot/bingbot/etc. ниже оставлены рядом ради
// самодокументируемости списка, а не потому что без них ничего бы не поймалось.
//
// Реальные дополнения — категории, которые НЕ содержат "bot/crawl/spider" в названии:
// - Соцсети/мессенджеры/превью ссылок: facebookexternalhit, meta-externalads, whatsapp, vkshare,
//   pinterest, tumblr, skypeuripreview.
// - Архивные краулеры: ia_archiver (archive.org), heritrix.
// - Рекламные/поисковые краулеры без "bot": mediapartners-google.
// - Мониторинг доступности (не живой посетитель, хоть и не угроза): pingdom, uptimerobot,
//   statuscake, site24x7, newrelicpinger, freshping, monitis.
// - Валидаторы разметки: w3c_validator, w3c-checklink.
// - HTTP-библиотеки/консольные утилиты — реальный браузер НИКОГДА не шлёт такой UA сам по себе,
//   это всегда скрипт/сервер: curl, wget, python-requests/urllib, go-http-client, okhttp,
//   apache-httpclient, libwww-perl, postmanruntime, insomnia, node-fetch, axios, scrapy, java.
// - Автоматизация браузера/скрейпинг (headless-режим — не обычный визит): headlesschrome,
//   phantomjs, selenium, puppeteer, playwright.
//
// НЕ добавлены намеренно (риск ложных срабатываний на реальных посетителях этого продукта):
// голое "telegram"/"viber" — рискует поймать настоящие in-app-браузеры Telegram/Viber (в отличие
// от TikTok, чьи детектируемые маркеры BytedanceWebview/musical_ly уже проверены отдельно в
// apps/sdk/src/browser.ts — нет уверенности, что Telegram/Viber не встраивают имя приложения в
// UA своего WebView, а Telegram — центральный канал этого продукта, ошибиться здесь дорого);
// "instagram" — реальный in-app-браузер Instagram буквально содержит "Instagram" в UA и это
// частый источник настоящего рекламного трафика (см. CLAUDE.md, реальный пример UA с
// "Instagram 448.0.0.52.84").
const BOT_USER_AGENT_PATTERN =
  /bot|crawl|spider|facebookexternalhit|meta-externalads|whatsapp|slackbot|discordbot|linkedinbot|googlebot|bingbot|duckduckbot|baiduspider|yandexbot|applebot|skypeuripreview|vkshare|redditbot|pinterest|tumblr|ia_archiver|heritrix|mediapartners-google|semrushbot|ahrefsbot|pingdom|uptimerobot|statuscake|site24x7|newrelicpinger|freshping|monitis|w3c_validator|w3c-checklink|curl\/|wget\/|python-requests|python-urllib|go-http-client|okhttp|apache-httpclient|libwww-perl|postmanruntime|insomnia|node-fetch|axios\/|scrapy|java\/|headlesschrome|phantomjs|selenium|puppeteer|playwright/i;

export function isBotUserAgent(userAgent: string | undefined): boolean {
  return !!userAgent && BOT_USER_AGENT_PATTERN.test(userAgent);
}
