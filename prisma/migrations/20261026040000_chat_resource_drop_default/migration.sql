-- Временный DEFAULT 'PERSONAL' нужен был только на время выкладки (старый API не знал о resource).
-- Новый код всегда передаёт ресурс явно.
ALTER TABLE "ChatTag" ALTER COLUMN "resource" DROP DEFAULT;
ALTER TABLE "ChatStage" ALTER COLUMN "resource" DROP DEFAULT;
ALTER TABLE "ChatCustomField" ALTER COLUMN "resource" DROP DEFAULT;
ALTER TABLE "ChatTemplateFolder" ALTER COLUMN "resource" DROP DEFAULT;
