-- Области прав на изменение/удаление доменов (свои / доступных проектов / все) + автор домена.
ALTER TYPE "Permission" ADD VALUE IF NOT EXISTS 'DOMAINS_EDIT_OWN';
ALTER TYPE "Permission" ADD VALUE IF NOT EXISTS 'DOMAINS_EDIT_PROJECTS';
ALTER TYPE "Permission" ADD VALUE IF NOT EXISTS 'DOMAINS_DELETE_OWN';
ALTER TYPE "Permission" ADD VALUE IF NOT EXISTS 'DOMAINS_DELETE_PROJECTS';

ALTER TABLE "Domain" ADD COLUMN "createdById" TEXT;
ALTER TABLE "Domain" ADD CONSTRAINT "Domain_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
