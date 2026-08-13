-- Причина автоматического отключения личного MTProto-аккаунта (проверка живости сессии,
-- см. TelegramPersonalService.handleDeadSession) — отличает "сессию отозвал Telegram" от
-- "никогда не подключали" / "отключили вручную".
ALTER TABLE "Channel" ADD COLUMN "tgPersonalLastError" TEXT;
