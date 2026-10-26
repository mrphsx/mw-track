-- Цепочка сообщений в шаблоне ответа (2026-10-25). Новая таблица + перенос существующих шаблонов
-- первым сообщением (старые колонки шаблона не трогаем — код читает их как запасной вариант).
-- CreateTable
CREATE TABLE "ChatTemplateMessage" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "text" TEXT,
    "mediaKind" TEXT,
    "mediaKey" TEXT,
    "mediaFileName" TEXT,
    "mediaMime" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatTemplateMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChatTemplateMessage_templateId_sortOrder_idx" ON "ChatTemplateMessage"("templateId", "sortOrder");

-- AddForeignKey
ALTER TABLE "ChatTemplateMessage" ADD CONSTRAINT "ChatTemplateMessage_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ChatTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Перенос: каждый шаблон со старым содержимым → одно сообщение цепочки.
INSERT INTO "ChatTemplateMessage" ("id", "templateId", "sortOrder", "text", "mediaKind", "mediaKey", "mediaFileName", "mediaMime", "createdAt")
SELECT 'ctm' || substr(md5(t."id" || random()::text), 1, 22), t."id", 0, t."text", t."mediaKind", t."mediaKey", t."mediaFileName", t."mediaMime", t."createdAt"
FROM "ChatTemplate" t
WHERE (t."text" IS NOT NULL OR t."mediaKey" IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM "ChatTemplateMessage" m WHERE m."templateId" = t."id");
