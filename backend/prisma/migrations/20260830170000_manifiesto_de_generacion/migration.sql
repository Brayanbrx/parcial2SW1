-- Manifiesto de generacion (ADR-018 enmendado).
--
-- ADR-018 no guarda el ZIP: promete regenerarlo desde el snapshot congelado.
-- Faltaba congelar el resto de las entradas de la emision, asi que el paquete
-- Java elegido se perdia y el nombre del proyecto se releia de la pizarra.
--
-- Las filas existentes se rellenan con lo que **de hecho** se usaba al
-- descargarlas: el paquete por defecto del generador y el nombre actual de su
-- pizarra. No es una reconstruccion inventada — es exactamente lo que la ruta de
-- descarga hacia antes de este cambio.

CREATE TYPE "GenerationStatus" AS ENUM ('CREATING', 'READY', 'FAILED');

ALTER TABLE "generations"
  ADD COLUMN "projectName"   TEXT,
  ADD COLUMN "artifactId"    TEXT,
  ADD COLUMN "basePackage"   TEXT NOT NULL DEFAULT 'bo.edu.sw1',
  ADD COLUMN "schemaVersion" TEXT NOT NULL DEFAULT '1.0.0',
  ADD COLUMN "templatesHash" TEXT NOT NULL DEFAULT 'desconocida',
  ADD COLUMN "status" "GenerationStatus" NOT NULL DEFAULT 'CREATING',
  ADD COLUMN "error"        TEXT,
  ADD COLUMN "springSha256" TEXT,
  ADD COLUMN "dartSha256"   TEXT;

UPDATE "generations" AS g
SET "projectName" = b."displayName",
    "artifactId"  = lower(regexp_replace(b."displayName", '[^a-zA-Z0-9]+', '-', 'g')),
    -- READY sin huellas: son anteriores al manifiesto y no hay con que
    -- comparar. La ruta de descarga lo distingue de una generacion nueva.
    "status"      = 'READY'
FROM "boards" AS b
WHERE b."id" = g."boardId";

ALTER TABLE "generations"
  ALTER COLUMN "projectName" SET NOT NULL,
  ALTER COLUMN "artifactId"  SET NOT NULL;

-- Los valores por defecto existian solo para poder rellenar lo que ya estaba.
-- Una generacion nueva declara los suyos: si el codigo se olvida de uno, tiene
-- que fallar, no heredar un valor plausible.
ALTER TABLE "generations"
  ALTER COLUMN "basePackage"   DROP DEFAULT,
  ALTER COLUMN "schemaVersion" DROP DEFAULT,
  ALTER COLUMN "templatesHash" DROP DEFAULT;
