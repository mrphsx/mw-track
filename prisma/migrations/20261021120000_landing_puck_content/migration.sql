-- Визуальный редактор Puck (2026-10-21): содержимое лендинга в отдельной таблице.
CREATE TABLE "LandingPuckContent" (
    "landingId" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "html" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LandingPuckContent_pkey" PRIMARY KEY ("landingId")
);

ALTER TABLE "LandingPuckContent" ADD CONSTRAINT "LandingPuckContent_landingId_fkey" FOREIGN KEY ("landingId") REFERENCES "Landing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
