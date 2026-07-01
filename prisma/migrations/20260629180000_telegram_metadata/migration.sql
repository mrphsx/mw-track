-- Метаданные, подтянутые из Telegram (getMe/getChat/getChatMemberCount) для отображения
-- в карточке канала в UI (название, фото, число участников) — см. TelegramProvider.initialize().
ALTER TABLE "Channel" ADD COLUMN "tgBotId" TEXT;
ALTER TABLE "Channel" ADD COLUMN "tgBotFirstName" TEXT;
ALTER TABLE "Channel" ADD COLUMN "tgChannelTitle" TEXT;
ALTER TABLE "Channel" ADD COLUMN "tgChannelMembersCount" INTEGER;
ALTER TABLE "Channel" ADD COLUMN "tgAvatarFileId" TEXT;
