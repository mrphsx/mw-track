-- AlterTable
ALTER TABLE "Landing" DROP COLUMN "cloakingCountries",
DROP COLUMN "cloakingRedirectUrl",
DROP COLUMN "cloakingType";

-- DropEnum
DROP TYPE "CloakingType";
