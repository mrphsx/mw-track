-- Больше данных о клиенте из Telegram (запрос пользователя 2026-07-04): is_premium приходит
-- бесплатно на каждом апдейте от Telegram. tgPhotoUrl уже существовал в схеме (не трогаем).
ALTER TABLE "Client" ADD COLUMN "tgIsPremium" BOOLEAN;
