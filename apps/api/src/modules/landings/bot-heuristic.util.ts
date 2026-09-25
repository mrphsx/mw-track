import { Request } from 'express';
import { getClientIp } from '../../common/client-ip.util';
import { isBotUserAgent } from '../../common/bot-user-agent.util';
import { HOSTING_IP_RANGES } from './cloaking/hosting-ip-ranges';
import { ipMatchesAnyRange } from './cloaking/conditions/ip-range.util';

// Общая эвристика "похоже на бота" — используется и условием BOT в клоакинге
// (cloaking/conditions/network.evaluators.ts), и отдельным счётчиком Landing.botVisitsCount в
// LandingRendererService (запрос пользователя 2026-09-25: "в кейтаро показывает сколько ботов
// пришло") — счётчик считается на КАЖДОМ визите независимо от того, включён ли клоакинг и есть
// ли в его правилах условие BOT вообще, поэтому не может просто дёргать BotConditionEvaluator
// (тот вообще не вызывается, если клоакинг выключен).
//
// Три сигнала, объединённые ИЛИ:
// 1. Пустой User-Agent — простейший скрипт/curl, реальный браузер его всегда шлёт.
// 2. Известный краулер/бот по имени в User-Agent (isBotUserAgent, common/bot-user-agent.util.ts)
//    — тот же список, что уже доказал себя на реальном инциденте 2026-07-29 (Facebook сам
//    сканирует лендинг краулером-препросмотрщиком facebookexternalhit почти на каждый показ
//    рекламы) — самоидентифицирующиеся боты (facebookexternalhit/Googlebot/WhatsApp/Telegram и
//    т.п.), которых чистая проверка по IP-диапазону вообще не ловит, т.к. эти краулеры работают
//    не только с датацентровых IP крупных облаков.
// 3. IP из известного датацентрового диапазона (HOSTING_IP_RANGES) — анонимные скрипты/скрейперы
//    на дешёвом VPS, которые НЕ представляются в User-Agent (в отличие от пункта 2).
// Заведомо слабее платной курируемой базы ботов Keitaro (открыто написано в подсказке UI рядом
// с условием BOT) — реальный человек на VPN/корпоративной сети тоже может попасть под пункт 3,
// это осознанный компромисс бесплатного тира.
export function isLikelyBotRequest(req: Request): boolean {
  const userAgent = req.headers['user-agent'] as string | undefined;
  if (!userAgent || !userAgent.trim()) return true;
  if (isBotUserAgent(userAgent)) return true;

  const ip = getClientIp(req);
  if (!ip) return false;
  return ipMatchesAnyRange(ip, HOSTING_IP_RANGES);
}
