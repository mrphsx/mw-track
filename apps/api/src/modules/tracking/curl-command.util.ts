import { PixelPlatform } from '@prisma/client';

// Готовая curl-команда с реальным access_token, чтобы можно было вставить прямо в терминал
// (запрос пользователя 2026-07-29/30) — используется и в Pixel Logs UI (только для OWNER, см.
// ProjectsService.getPixelLogs), и в проверке ивента при создании/редактировании пикселя (см.
// PixelsService). Вынесено сюда одной функцией, чтобы формат запроса не разъезжался между
// двумя местами — TikTok-часть уже один раз ловила баг именно на этом (см. комментарий ниже).
export function buildPixelCurlCommand(
  platform: PixelPlatform,
  pixelId: string,
  accessToken: string,
  requestPayload: unknown,
  testEventCode?: string | null,
): string {
  if (platform === 'FACEBOOK') {
    // requestPayload уже массив ([eventData], см. FacebookCAPIService) — реальный wire-формат
    // Facebook: {data: [...], access_token, test_event_code?}.
    const body: Record<string, unknown> = { data: requestPayload, access_token: accessToken };
    if (testEventCode) body.test_event_code = testEventCode;
    return `curl -X POST "https://graph.facebook.com/v18.0/${pixelId}/events" -H "Content-Type: application/json" -d '${JSON.stringify(body)}'`;
  }

  // TikTok: requestPayload — уже ПОЛНОЕ плоское тело запроса (PixelTrackBody, см.
  // TikTokEventsService после сверки со схемой 2026-07-29), БЕЗ обёртки в {data:[...]} — раньше
  // здесь (в getPixelLogs) как раз стояла эта неверная обёртка, оставшаяся от старой, ещё
  // Facebook-подобной версии TikTokEventsService, и не обновлённая после фикса схемы. Access-Token
  // — в заголовке, не в теле.
  return `curl -X POST "https://business-api.tiktok.com/open_api/v1.3/pixel/track/" -H "Content-Type: application/json" -H "Access-Token: ${accessToken}" -d '${JSON.stringify(requestPayload)}'`;
}
