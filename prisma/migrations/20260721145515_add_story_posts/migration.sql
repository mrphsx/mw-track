-- CreateEnum
CREATE TYPE "StoryPostStatus" AS ENUM ('PENDING', 'PUBLISHING', 'PUBLISHED', 'FAILED');

-- CreateEnum
CREATE TYPE "StoryMediaType" AS ENUM ('PHOTO', 'VIDEO');

-- CreateTable
CREATE TABLE "StoryPost" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "mediaKey" TEXT NOT NULL,
    "mediaType" "StoryMediaType" NOT NULL,
    "caption" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "status" "StoryPostStatus" NOT NULL DEFAULT 'PENDING',
    "publishedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "StoryPost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StoryPost_status_scheduledAt_idx" ON "StoryPost"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "StoryPost_companyId_projectId_idx" ON "StoryPost"("companyId", "projectId");

-- AddForeignKey
ALTER TABLE "StoryPost" ADD CONSTRAINT "StoryPost_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoryPost" ADD CONSTRAINT "StoryPost_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
