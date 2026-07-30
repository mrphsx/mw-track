-- AlterTable
ALTER TABLE "BotScenario" ADD COLUMN     "abTestGroupId" TEXT,
ADD COLUMN     "abTestWeight" INTEGER,
ADD COLUMN     "isAbTestVariant" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ScenarioAbTestGroup" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "resultsSnapshot" JSONB,

    CONSTRAINT "ScenarioAbTestGroup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScenarioAbTestGroup_channelId_idx" ON "ScenarioAbTestGroup"("channelId");

-- CreateIndex
CREATE INDEX "BotScenario_abTestGroupId_idx" ON "BotScenario"("abTestGroupId");

-- AddForeignKey
ALTER TABLE "ScenarioAbTestGroup" ADD CONSTRAINT "ScenarioAbTestGroup_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BotScenario" ADD CONSTRAINT "BotScenario_abTestGroupId_fkey" FOREIGN KEY ("abTestGroupId") REFERENCES "ScenarioAbTestGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
