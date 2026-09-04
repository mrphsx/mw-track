-- CreateTable
CREATE TABLE "PaymentDetailsLog" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "clientId" TEXT,
    "tgUserId" TEXT NOT NULL,
    "messageText" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentDetailsLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaymentDetailsLog_projectId_sentAt_idx" ON "PaymentDetailsLog"("projectId", "sentAt");

-- AddForeignKey
ALTER TABLE "PaymentDetailsLog" ADD CONSTRAINT "PaymentDetailsLog_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentDetailsLog" ADD CONSTRAINT "PaymentDetailsLog_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
