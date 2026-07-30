-- CreateEnum
CREATE TYPE "BotScenarioStepType" AS ENUM ('DELAY', 'SEND_MESSAGE', 'CONDITION');

-- AlterTable
ALTER TABLE "BotScenario" ADD COLUMN     "firstStepId" TEXT;

-- CreateTable
CREATE TABLE "BotScenarioStep" (
    "id" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "type" "BotScenarioStepType" NOT NULL,
    "delaySeconds" INTEGER,
    "messageText" TEXT,
    "messageMedia" JSONB,
    "buttons" JSONB,
    "conditionFilter" JSONB,
    "onSuccessStepId" TEXT,
    "onFailureStepId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BotScenarioStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BotScenarioRun" (
    "id" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "tgUserId" TEXT NOT NULL,
    "clientId" TEXT,
    "status" "AutomationEnrollmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "currentStepId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "BotScenarioRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BotScenarioStep_scenarioId_idx" ON "BotScenarioStep"("scenarioId");

-- CreateIndex
CREATE INDEX "BotScenarioRun_scenarioId_status_idx" ON "BotScenarioRun"("scenarioId", "status");

-- AddForeignKey
ALTER TABLE "BotScenarioStep" ADD CONSTRAINT "BotScenarioStep_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "BotScenario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BotScenarioRun" ADD CONSTRAINT "BotScenarioRun_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "BotScenario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
