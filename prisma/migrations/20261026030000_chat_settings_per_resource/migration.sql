-- Настройки чатов отдельно для бота и лички (2026-10-25: «бот и личка не должны быть связаны по
-- настройкам, бот — отдельная сущность»). Этапы, теги, свои поля и папки шаблонов получают ресурс.
-- DEFAULT 'PERSONAL' — всё уже созданное настраивалось для лички (проверено по использованию в
-- диалогах), и он же страхует старую версию API в окне до выкладки. Default снимается отдельной
-- миграцией после выкладки нового кода.

DROP INDEX "ChatTag_projectId_name_key";
DROP INDEX "ChatStage_projectId_idx";
DROP INDEX "ChatCustomField_projectId_idx";

ALTER TABLE "ChatTag" ADD COLUMN "resource" TEXT NOT NULL DEFAULT 'PERSONAL';
ALTER TABLE "ChatStage" ADD COLUMN "resource" TEXT NOT NULL DEFAULT 'PERSONAL';
ALTER TABLE "ChatCustomField" ADD COLUMN "resource" TEXT NOT NULL DEFAULT 'PERSONAL';
ALTER TABLE "ChatTemplateFolder" ADD COLUMN "resource" TEXT NOT NULL DEFAULT 'PERSONAL';

CREATE UNIQUE INDEX "ChatTag_projectId_resource_name_key" ON "ChatTag"("projectId", "resource", "name");
CREATE INDEX "ChatStage_projectId_resource_idx" ON "ChatStage"("projectId", "resource");
CREATE INDEX "ChatCustomField_projectId_resource_idx" ON "ChatCustomField"("projectId", "resource");

-- Бот-диалог, который этап лички передал оператору, возвращается «без ответственного», как было до
-- этого (до 2026-10-25 этапы срабатывали на все диалоги проекта сразу).
INSERT INTO "ChatMessage" ("id", "conversationId", "direction", "senderType", "text", "createdAt")
SELECT 'cmsys' || substr(md5(c.id || random()::text), 1, 20), c.id, 'OUT', 'SYSTEM',
       'Этап лички снят: у бота и лички теперь свои настройки — ответственный тоже снят', now()
FROM "Conversation" c
WHERE c.source <> 'PERSONAL' AND c."stageId" IS NOT NULL AND c."assignedUserId" IS NOT NULL
  AND EXISTS (SELECT 1 FROM "ChatMessage" m WHERE m."conversationId" = c.id AND m."senderType" = 'SYSTEM' AND m.text LIKE 'Этап «%передан оператору%');

UPDATE "Conversation" c SET "assignedUserId" = NULL, "assignedAt" = NULL
WHERE c.source <> 'PERSONAL' AND c."stageId" IS NOT NULL AND c."assignedUserId" IS NOT NULL
  AND EXISTS (SELECT 1 FROM "ChatMessage" m WHERE m."conversationId" = c.id AND m."senderType" = 'SYSTEM' AND m.text LIKE 'Этап «%передан оператору%');

-- Этапы лички снимаются с диалогов бота.
UPDATE "Conversation" SET "stageId" = NULL WHERE source <> 'PERSONAL' AND "stageId" IS NOT NULL;
