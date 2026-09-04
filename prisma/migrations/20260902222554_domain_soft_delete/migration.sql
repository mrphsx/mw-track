-- Domain soft delete: add deletedAt, replace plain unique index with a partial one
-- (WHERE "deletedAt" IS NULL) so a hostname can be re-added after being "deleted".
ALTER TABLE "Domain" ADD COLUMN "deletedAt" TIMESTAMP(3);

DROP INDEX "Domain_domain_key";
CREATE UNIQUE INDEX "Domain_domain_key" ON "Domain"("domain") WHERE "deletedAt" IS NULL;
