-- CreateTable
CREATE TABLE "CloakingLog" (
    "id" TEXT NOT NULL,
    "landingId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "ruleId" TEXT,
    "ruleName" TEXT,
    "action" "CloakingActionType" NOT NULL,
    "matchedConditions" JSONB NOT NULL,
    "requestSnapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CloakingLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CloakingLog_landingId_createdAt_idx" ON "CloakingLog"("landingId", "createdAt");

-- CreateIndex
CREATE INDEX "CloakingLog_companyId_createdAt_idx" ON "CloakingLog"("companyId", "createdAt");

-- AddForeignKey
ALTER TABLE "CloakingLog" ADD CONSTRAINT "CloakingLog_landingId_fkey" FOREIGN KEY ("landingId") REFERENCES "Landing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CloakingLog" ADD CONSTRAINT "CloakingLog_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "CloakingRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;
