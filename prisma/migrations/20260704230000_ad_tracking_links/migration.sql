-- Трекинг-ссылки лендинга: пиксель + рекламные макросы Facebook/TikTok (запрос пользователя
-- 2026-07-04, "получить ссылку" с выбором пикселя и ad_id/campaign_id/... в query-параметрах).
ALTER TABLE "Project" ADD COLUMN "linkParamMap" JSONB;

ALTER TABLE "Client" ADD COLUMN "pixelId" TEXT;
ALTER TABLE "Client" ADD COLUMN "adId" TEXT;
ALTER TABLE "Client" ADD COLUMN "adName" TEXT;
ALTER TABLE "Client" ADD COLUMN "adsetId" TEXT;
ALTER TABLE "Client" ADD COLUMN "adsetName" TEXT;
ALTER TABLE "Client" ADD COLUMN "campaignId" TEXT;
ALTER TABLE "Client" ADD COLUMN "campaignName" TEXT;
ALTER TABLE "Client" ADD COLUMN "placement" TEXT;
ALTER TABLE "Client" ADD COLUMN "siteSourceName" TEXT;

ALTER TABLE "TrackingEvent" ADD COLUMN "pixelId" TEXT;
ALTER TABLE "TrackingEvent" ADD COLUMN "adId" TEXT;
ALTER TABLE "TrackingEvent" ADD COLUMN "adName" TEXT;
ALTER TABLE "TrackingEvent" ADD COLUMN "adsetId" TEXT;
ALTER TABLE "TrackingEvent" ADD COLUMN "adsetName" TEXT;
ALTER TABLE "TrackingEvent" ADD COLUMN "campaignId" TEXT;
ALTER TABLE "TrackingEvent" ADD COLUMN "campaignName" TEXT;
ALTER TABLE "TrackingEvent" ADD COLUMN "placement" TEXT;
ALTER TABLE "TrackingEvent" ADD COLUMN "siteSourceName" TEXT;

CREATE INDEX "TrackingEvent_projectId_campaignId_idx" ON "TrackingEvent"("projectId", "campaignId");
CREATE INDEX "TrackingEvent_projectId_adId_idx" ON "TrackingEvent"("projectId", "adId");
