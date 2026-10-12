-- Области прав на изменение/удаление лендингов: свои / доступных проектов / все.
CREATE TYPE "LandingsActionScope" AS ENUM ('NONE', 'OWN', 'PROJECTS', 'ALL');
ALTER TABLE "User" ADD COLUMN "landingsEditScope" "LandingsActionScope" NOT NULL DEFAULT 'NONE';
ALTER TABLE "User" ADD COLUMN "landingsDeleteScope" "LandingsActionScope" NOT NULL DEFAULT 'NONE';
