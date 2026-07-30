-- AlterTable: чисто аддитивная миграция, nullable-колонки, старые строки просто остаются NULL
-- (означает "отправлено до появления этой фичи логирования").
ALTER TABLE "TrackingEventDelivery" ADD COLUMN "requestPayload" JSONB;
ALTER TABLE "TrackingEventDelivery" ADD COLUMN "responsePayload" JSONB;
