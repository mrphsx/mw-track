-- Дополнительный попап лендинга (запрос клиентов 2026-10-02) — см. Landing.extraPopupEnabled
-- в schema.prisma и extra-popup.util.ts. Чисто аддитивно: у всех существующих лендингов
-- extraPopupEnabled=false, то есть поведение не меняется ни у одного из них.
ALTER TABLE "Landing" ADD COLUMN     "extraPopupConfig" JSONB,
ADD COLUMN     "extraPopupEnabled" BOOLEAN NOT NULL DEFAULT false;
