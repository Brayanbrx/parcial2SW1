ALTER TABLE "users"
  ADD COLUMN "emailVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "emailVerificationTokenHash" TEXT,
  ADD COLUMN "emailVerificationExpiresAt" TIMESTAMP(3),
  ADD COLUMN "emailVerificationSentAt" TIMESTAMP(3);

-- Conservar el acceso de las cuentas anteriores a esta funcionalidad.
-- Las nuevas cuentas quedan pendientes por defecto (NULL).
UPDATE "users" SET "emailVerifiedAt" = "createdAt";

CREATE UNIQUE INDEX "users_emailVerificationTokenHash_key"
  ON "users"("emailVerificationTokenHash");
