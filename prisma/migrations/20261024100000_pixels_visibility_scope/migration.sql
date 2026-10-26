-- Видимость пикселей для баера (запрос пользователя 2026-10-24): только свои или все пиксели
-- проектов. Константный дефолт — мгновенно в PG 11+, все существующие сотрудники сразу получают
-- OWN_PIXELS («сразу поставь, чтобы все видели только свои»).
CREATE TYPE "PixelsVisibilityScope" AS ENUM ('OWN_PIXELS', 'PROJECT_PIXELS');

ALTER TABLE "User" ADD COLUMN "pixelsVisibilityScope" "PixelsVisibilityScope" NOT NULL DEFAULT 'OWN_PIXELS';
