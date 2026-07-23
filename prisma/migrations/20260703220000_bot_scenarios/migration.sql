-- Сценарии бота: команды + реакции на события (первый/повторный депозит, отписка) +
-- дефолтное сообщение. Запрос пользователя 2026-07-03.
CREATE TYPE "BotScenarioTrigger" AS ENUM ('COMMAND', 'FIRST_DEPOSIT', 'REPEAT_DEPOSIT', 'UNSUBSCRIBE', 'DEFAULT');

CREATE TABLE "BotScenario" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "triggerType" "BotScenarioTrigger" NOT NULL,
    "command" TEXT NOT NULL DEFAULT '',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "delaySeconds" INTEGER NOT NULL DEFAULT 0,
    "messageText" TEXT,
    "mediaType" TEXT,
    "mediaKey" TEXT,
    "buttons" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "BotScenario_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BotScenario_channelId_triggerType_command_key" ON "BotScenario"("channelId", "triggerType", "command");
CREATE INDEX "BotScenario_companyId_channelId_idx" ON "BotScenario"("companyId", "channelId");

ALTER TABLE "BotScenario" ADD CONSTRAINT "BotScenario_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
