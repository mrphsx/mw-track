-- 4 способа, которыми лендинг ведёт в Telegram (BOT_DIRECT/PRIVATE_CHANNEL_REQUEST/
-- PUBLIC_CHANNEL_DIRECT/PERSONAL_DM) — см. prisma/schema.prisma, enum TelegramMode.
CREATE TYPE "TelegramMode" AS ENUM ('BOT_DIRECT', 'PRIVATE_CHANNEL_REQUEST', 'PUBLIC_CHANNEL_DIRECT', 'PERSONAL_DM');

ALTER TABLE "Channel" ADD COLUMN "tgMode" "TelegramMode" DEFAULT 'BOT_DIRECT';
ALTER TABLE "Channel" ADD COLUMN "tgInviteLink" TEXT;
ALTER TABLE "Channel" ADD COLUMN "tgPersonalUsername" TEXT;
