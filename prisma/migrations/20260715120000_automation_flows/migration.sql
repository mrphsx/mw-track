-- Автоворонки (Drip Campaigns, Фаза 3.1, запрос пользователя 2026-07-15).
CREATE TYPE "AutomationStepType" AS ENUM ('DELAY', 'SEND_PUSH', 'CONDITION');
CREATE TYPE "AutomationEnrollmentStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'EXITED', 'FAILED');

CREATE TABLE "AutomationFlow" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "triggerEvent" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "firstStepId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "AutomationFlow_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AutomationStep" (
    "id" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "type" "AutomationStepType" NOT NULL,
    "delaySeconds" INTEGER,
    "messageText" TEXT,
    "mediaType" TEXT,
    "mediaKey" TEXT,
    "buttons" JSONB,
    "conditionFilter" JSONB,
    "onSuccessStepId" TEXT,
    "onFailureStepId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationStep_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AutomationEnrollment" (
    "id" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "status" "AutomationEnrollmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "currentStepId" TEXT,
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AutomationEnrollment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AutomationFlow_projectId_triggerEvent_isActive_idx" ON "AutomationFlow"("projectId", "triggerEvent", "isActive");

CREATE INDEX "AutomationStep_flowId_idx" ON "AutomationStep"("flowId");

CREATE UNIQUE INDEX "AutomationEnrollment_flowId_clientId_key" ON "AutomationEnrollment"("flowId", "clientId");
CREATE INDEX "AutomationEnrollment_projectId_idx" ON "AutomationEnrollment"("projectId");

ALTER TABLE "AutomationFlow" ADD CONSTRAINT "AutomationFlow_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AutomationStep" ADD CONSTRAINT "AutomationStep_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "AutomationFlow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AutomationEnrollment" ADD CONSTRAINT "AutomationEnrollment_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "AutomationFlow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AutomationEnrollment" ADD CONSTRAINT "AutomationEnrollment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AutomationEnrollment" ADD CONSTRAINT "AutomationEnrollment_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
