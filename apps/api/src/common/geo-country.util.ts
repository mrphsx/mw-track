import * as geoip from 'geoip-lite';
import { Request } from 'express';
import { getClientIp } from './client-ip.util';

// Вынесено из LandingRendererService — используется НЕ только клоакингом
// (CloakingService.isCountryAllowed), но и независимо для countryCode в атрибуции Facebook
// Advanced Matching (LandingRendererService.injectTrackingScripts), поэтому это общий util,
// а не приватный метод одного сервиса.
//
// Клиентские домены — self-service (см. 04_BACKEND_PROJECTS_DOMAINS.md): клиент сам управляет
// DNS в своём аккаунте (Cloudflare или любой другой), платформа не держит Cloudflare-токен и
// не гарантирует, что домен проксируется через Cloudflare. Поэтому cf-ipcountry — только
// быстрый путь, когда он есть, а не единственный источник: офлайн-геобаза geoip-lite по IP
// работает для любого домена независимо от того, стоит ли перед ним Cloudflare.
export function resolveVisitorCountry(req: Request): string | null {
  const cfCountry = req.headers['cf-ipcountry'] as string | undefined;
  // "XX" — Cloudflare не смог определить страну, "T1" — Tor. Ни то ни другое не считаем
  // реальным ответом, чтобы не пропустить их через allow-list по ошибке.
  if (cfCountry && cfCountry !== 'XX' && cfCountry !== 'T1') return cfCountry.toUpperCase();

  const ip = getClientIp(req);
  if (!ip) return null;
  return geoip.lookup(ip)?.country ?? null;
}
