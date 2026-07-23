-- Персональная invite-ссылка на лендинг (PRIVATE_CHANNEL_REQUEST) + ссылка на лендинг у
-- клиента — позволяет точно посчитать подписчиков по каждому лендингу отдельно, а не только
-- по каналу/проекту в целом. ON DELETE SET NULL для Client.landingId — удаление лендинга не
-- должно каскадно удалять реальных подписчиков, только терять привязку к источнику.
ALTER TABLE "Landing" ADD COLUMN "tgInviteLink" TEXT;
ALTER TABLE "Client" ADD COLUMN "landingId" TEXT;

CREATE INDEX "Client_landingId_idx" ON "Client"("landingId");

ALTER TABLE "Client" ADD CONSTRAINT "Client_landingId_fkey"
    FOREIGN KEY ("landingId") REFERENCES "Landing"("id") ON DELETE SET NULL ON UPDATE CASCADE;
