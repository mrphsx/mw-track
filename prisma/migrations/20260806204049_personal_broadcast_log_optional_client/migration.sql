-- PersonalBroadcastLog.clientId стал опциональным (получатель может быть живым Telegram-
-- диалогом без строки Client) — снимаем NOT NULL и FK cascade остаётся как есть (Prisma default
-- ON DELETE RESTRICT/NO ACTION, не менялся). tgUserId/tgFirstName/tgUsername — новые снапшот-
-- поля. Таблица пуста в проде на момент миграции (проверено), поэтому tgUserId можно сразу
-- сделать NOT NULL без отдельного backfill-шага.
ALTER TABLE "PersonalBroadcastLog" ALTER COLUMN "clientId" DROP NOT NULL;
ALTER TABLE "PersonalBroadcastLog" ADD COLUMN "tgUserId" TEXT NOT NULL;
ALTER TABLE "PersonalBroadcastLog" ADD COLUMN "tgFirstName" TEXT;
ALTER TABLE "PersonalBroadcastLog" ADD COLUMN "tgUsername" TEXT;
