import { Request } from 'express';

// Вынесено из LandingRendererService (там было приватным методом, дублировавшимся бы в
// CloakingService) — единая точка получения IP посетителя лендинга: заголовки прокси/Cloudflare
// в приоритете, иначе реальный сокет.
export function getClientIp(req: Request): string {
  return (
    (req.headers['cf-connecting-ip'] as string) ||
    (req.headers['x-real-ip'] as string) ||
    req.socket.remoteAddress ||
    ''
  );
}
