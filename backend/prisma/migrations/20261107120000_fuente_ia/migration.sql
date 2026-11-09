-- Motor de IA del proyecto: la nube sigue siendo el valor por defecto.
-- CreateEnum
CREATE TYPE "AiSource" AS ENUM ('PROVIDERS', 'LOCAL');

-- AlterTable
ALTER TABLE "project_ai_settings" ADD COLUMN "aiSource" "AiSource" NOT NULL DEFAULT 'PROVIDERS';
