-- Вторая половина 20261024180000_project_extra_bots: старый уникальный ключ диалога без botKey.
-- Применяется только после выкладки кода, который делает upsert по (channelId, source, botKey,
-- peerId) — иначе работающая версия API потеряла бы свой индекс для ON CONFLICT. Без него одна и
-- та же переписка через основного и дополнительного бота упиралась бы в старое ограничение.
DROP INDEX IF EXISTS "Conversation_channelId_source_peerId_key";
