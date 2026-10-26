-- Назначение операторов на чаты отдельных ресурсов (запрос пользователя 2026-10-24): основной бот, дополнительный
-- бот, личка. Новая таблица + перенос текущего доступа: каждый оператор получает «основной бот» и/или «личку»
-- в проектах, где он уже есть, ровно по своему User.chatAccess — так никто не теряет чаты, которые видел.

-- CreateTable
CREATE TABLE "ChatResourceAccess" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatResourceAccess_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChatResourceAccess_userId_idx" ON "ChatResourceAccess"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatResourceAccess_projectId_resource_userId_key" ON "ChatResourceAccess"("projectId", "resource", "userId");


-- Перенос текущего доступа (идемпотентно).
INSERT INTO "ChatResourceAccess" ("id", "companyId", "projectId", "userId", "resource", "createdAt")
SELECT gen_random_uuid()::text, u."companyId", pa."projectId", u."id", r.resource, now()
FROM "User" u
JOIN "ProjectAccess" pa ON pa."userId" = u."id"
JOIN "Project" pr ON pr."id" = pa."projectId" AND pr."deletedAt" IS NULL
JOIN "Channel" ch ON ch."projectId" = pr."id" AND ch."type" = 'TELEGRAM'
CROSS JOIN (VALUES ('BOT'), ('PERSONAL')) AS r(resource)
WHERE u."role" = 'OPERATOR' AND u."deletedAt" IS NULL
  AND ((r.resource = 'BOT' AND u."chatAccess" IN ('ALL', 'BOT')) OR (r.resource = 'PERSONAL' AND u."chatAccess" IN ('ALL', 'PERSONAL')))
ON CONFLICT ("projectId", "resource", "userId") DO NOTHING;
