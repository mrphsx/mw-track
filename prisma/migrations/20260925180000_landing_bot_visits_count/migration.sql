-- Счётчик визитов, похожих на бота (запрос пользователя 2026-09-25: "в кейтаро показывает
-- сколько ботов пришло") — денормализованный, инкрементируется в
-- LandingRendererService.renderAndServe независимо от того, включён ли клоакинг вообще.
ALTER TABLE "Landing" ADD COLUMN "botVisitsCount" INTEGER NOT NULL DEFAULT 0;
