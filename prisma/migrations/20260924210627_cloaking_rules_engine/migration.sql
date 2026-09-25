-- CreateEnum
CREATE TYPE "CloakingRuleMatchLogic" AS ENUM ('AND', 'OR');

-- CreateEnum
CREATE TYPE "CloakingActionType" AS ENUM ('ALLOW', 'REDIRECT', 'PRELANDING', 'NOT_FOUND', 'BLANK', 'CUSTOM_HTML', 'CUSTOM_TEXT');

-- CreateEnum
CREATE TYPE "CloakingConditionField" AS ENUM ('COUNTRY', 'REGION', 'CITY', 'IP', 'REFERRER', 'USER_AGENT', 'X_REQUESTED_WITH', 'LANGUAGE', 'BROWSER', 'BROWSER_VERSION', 'OS', 'OS_VERSION', 'DEVICE_TYPE', 'DEVICE_MODEL', 'PARAMETER', 'DATE_BETWEEN', 'TIMETABLE', 'LIMIT_CLICKS', 'BOT', 'UNIQUENESS', 'PROXY', 'ISP', 'MOBILE_OPERATOR', 'CONNECTION_TYPE');

-- CreateTable
CREATE TABLE "CloakingRule" (
    "id" TEXT NOT NULL,
    "landingId" TEXT NOT NULL,
    "name" TEXT,
    "position" INTEGER NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "matchLogic" "CloakingRuleMatchLogic" NOT NULL DEFAULT 'AND',
    "action" "CloakingActionType" NOT NULL,
    "actionRedirectUrl" TEXT,
    "actionCustomHtml" TEXT,
    "actionCustomText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CloakingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CloakingCondition" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "field" "CloakingConditionField" NOT NULL,
    "negate" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CloakingCondition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CloakingRule_landingId_position_idx" ON "CloakingRule"("landingId", "position");

-- CreateIndex
CREATE INDEX "CloakingCondition_ruleId_idx" ON "CloakingCondition"("ruleId");

-- AddForeignKey
ALTER TABLE "CloakingRule" ADD CONSTRAINT "CloakingRule_landingId_fkey" FOREIGN KEY ("landingId") REFERENCES "Landing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CloakingCondition" ADD CONSTRAINT "CloakingCondition_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "CloakingRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
