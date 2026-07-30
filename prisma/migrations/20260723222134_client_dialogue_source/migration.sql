-- CreateEnum
CREATE TYPE "DialogueSource" AS ENUM ('PERSONAL_ACCOUNT', 'BOT_DIRECT', 'MANAGER_CONFIRM', 'CRM_BUTTON');

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "dialogueSource" "DialogueSource";
