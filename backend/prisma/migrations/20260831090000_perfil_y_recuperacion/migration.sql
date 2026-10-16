-- Perfil de usuario y recuperacion de contrasena (RF-A10, RF-A11).
--
-- La foto se guarda en la base y no en disco ni en almacenamiento de objetos:
-- la plataforma no tiene ninguno de los dos, y la ruta recorta la imagen a
-- 256x256, que son unas decenas de kilobytes por usuario.
--
-- Del testigo de recuperacion se guarda el hash, nunca el testigo, igual que
-- con los de refresco: quien lea la base no puede usarlo para entrar.

ALTER TABLE "users"
  ADD COLUMN "avatar" BYTEA,
  ADD COLUMN "avatarMimeType" TEXT;

CREATE TABLE "password_resets" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_resets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "password_resets_tokenHash_key" ON "password_resets"("tokenHash");
CREATE INDEX "password_resets_userId_idx" ON "password_resets"("userId");

ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
