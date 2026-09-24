import { Request } from 'express';
import * as geoip from 'geoip-lite';
import { PrismaService } from '../prisma/prisma.service';
import { invertParamMap, resolveParamMap } from '../modules/tracking/link-params.const';
import { resolveBuyerShortCode, resolvePixelShortCode } from './short-code.util';

// Собственная копия decodeAdMacro/UNSUBSTITUTED_MACRO_PATTERN (не импорт из
// landing-renderer.service.ts) — намеренно: там это непубличная, неоднократно чинившаяся вживую
// логика (см. историю правок 2026-08-20/27/31 в CLAUDE.md), рефакторить её ради переиспользования
// здесь означало бы риск для уже работающих TEMPLATE/CUSTOM-лендингов ради фичи, которая их не
// касается. Тот же класс дублирования уже принят в проекте между сервером и apps/sdk/src/browser.ts.
const UNSUBSTITUTED_MACRO_PATTERN = /\{\{|\}\}|^__[A-Z]/;

function decodeAdMacro(value: string | null): string | null {
  if (!value) return value;
  let decoded = value;
  if (/%[0-9A-Fa-f]{2}/.test(decoded)) {
    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      return null;
    }
  }
  return UNSUBSTITUTED_MACRO_PATTERN.test(decoded) ? null : decoded;
}

export function getClientIpFromRequest(req: Request): string {
  return (
    (req.headers['cf-connecting-ip'] as string) ||
    (req.headers['x-real-ip'] as string) ||
    req.headers['x-forwarded-for']?.toString().split(',')[0] ||
    req.socket.remoteAddress ||
    ''
  );
}

function resolveCountryFromRequest(req: Request): string | null {
  const cfCountry = req.headers['cf-ipcountry'] as string | undefined;
  if (cfCountry && cfCountry !== 'XX' && cfCountry !== 'T1') return cfCountry.toUpperCase();
  const ip = getClientIpFromRequest(req);
  if (!ip) return null;
  return geoip.lookup(ip)?.country ?? null;
}

export interface ExternalAttributionData {
  fbclid: string | null;
  ttclid: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  pixelId?: string;
  buyerRef?: string;
  adId?: string | null;
  adName?: string | null;
  adsetId?: string | null;
  adsetName?: string | null;
  campaignId?: string | null;
  campaignName?: string | null;
  placement?: string | null;
  siteSourceName?: string | null;
  ip: string;
  userAgent: string | undefined;
  countryCode: string | null;
  landingUrl: string;
  landingId: string | null;
  abTestGroupId: string | null;
}

// Строит тот же объект атрибуции, что LandingRendererService.injectTrackingScripts кладёт в
// start:<code> при рендере НАШЕГО лендинга — но по "сырым" query-параметрам ЛЮБОГО запроса, для
// лендинга клиента, который живёт целиком на его собственном сервере/домене (запрос пользователя
// 2026-09-04: "лэндинг будет на стороне клиента... нужно сделать чтобы можно было интегрировать
// скрипты api нашей СРМ, чтобы он считался как наш"). Используется TrackingController.tgRedirect,
// когда явный ?code= не передан — см. комментарий у места вызова.
export async function buildAttributionFromQuery(
  prisma: PrismaService,
  req: Request,
  linkParamMap: unknown,
  extra: { landingId: string | null; abTestGroupId: string | null },
): Promise<ExternalAttributionData> {
  const urlParams = new URLSearchParams(req.query as Record<string, string>);
  const paramMap = resolveParamMap(linkParamMap);
  const paramLookup = invertParamMap(paramMap);
  const adMacroData: Record<string, string | null> = {};
  for (const [actualName, semanticKey] of Object.entries(paramLookup)) {
    adMacroData[semanticKey] = decodeAdMacro(urlParams.get(actualName));
  }
  if (adMacroData.pixelId) adMacroData.pixelId = (await resolvePixelShortCode(prisma, adMacroData.pixelId)) ?? null;
  if (adMacroData.buyerRef) adMacroData.buyerRef = (await resolveBuyerShortCode(prisma, adMacroData.buyerRef)) ?? null;

  return {
    fbclid: urlParams.get('fbclid'),
    ttclid: urlParams.get('ttclid'),
    utmSource: urlParams.get('utm_source'),
    utmMedium: urlParams.get('utm_medium'),
    utmCampaign: decodeAdMacro(urlParams.get('utm_campaign')),
    utmContent: urlParams.get('utm_content'),
    ...adMacroData,
    ip: getClientIpFromRequest(req),
    userAgent: req.headers['user-agent'],
    countryCode: resolveCountryFromRequest(req),
    landingUrl: req.url,
    landingId: extra.landingId,
    abTestGroupId: extra.abTestGroupId,
  } as ExternalAttributionData;
}

// Есть ли в построенном блоке хоть один реальный сигнал атрибуции — genuine внешняя страница без
// единого рекламного параметра в query (например, кто-то просто вручную зашёл по прямой ссылке)
// не должна порождать новый start:<code> и одноразовую invite-ссылку впустую.
export function hasAnyAttributionSignal(data: ExternalAttributionData): boolean {
  const { ip: _ip, userAgent: _userAgent, countryCode: _countryCode, landingUrl: _landingUrl, landingId: _landingId, abTestGroupId: _abTestGroupId, ...signal } = data;
  return Object.values(signal).some((v) => v != null);
}
