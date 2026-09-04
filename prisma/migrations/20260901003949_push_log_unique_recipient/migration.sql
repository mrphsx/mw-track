-- CreateIndex
CREATE UNIQUE INDEX "PushLog_pushId_clientId_key" ON "PushLog"("pushId", "clientId");
