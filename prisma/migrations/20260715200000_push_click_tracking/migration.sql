-- Smart Push Timing (Фаза 3.4, запрос пользователя 2026-07-15) — первый клик-трекинг в
-- проекте: клики по кнопкам пушей засекаются через новый публичный редирект
-- (TrackingController.pushClickRedirect), первый клик на отправление пишется сюда.
ALTER TABLE "PushLog" ADD COLUMN "clickedAt" TIMESTAMP(3);
