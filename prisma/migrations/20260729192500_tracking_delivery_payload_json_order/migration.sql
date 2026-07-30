-- jsonb (тип по умолчанию для Prisma Json) не сохраняет порядок ключей — Postgres
-- пересобирает объект в свой внутренний бинарный формат при записи, порядок при чтении
-- обратно не гарантирован. requestPayload/responsePayload специально должны совпадать
-- "точь-в-точь" с реальным телом запроса/ответа (запрос пользователя 2026-07-29) — plain
-- json хранит исходный текст как есть, порядок ключей сохраняется. Существующие строки
-- при конвертации сохраняют уже перемешанный jsonb-порядок (восстановить оригинальный
-- порядок для них невозможно — jsonb его уже отбросил при первой записи), эффект только
-- для новых записей.
ALTER TABLE "TrackingEventDelivery" ALTER COLUMN "requestPayload" TYPE json USING "requestPayload"::json;
ALTER TABLE "TrackingEventDelivery" ALTER COLUMN "responsePayload" TYPE json USING "responsePayload"::json;
