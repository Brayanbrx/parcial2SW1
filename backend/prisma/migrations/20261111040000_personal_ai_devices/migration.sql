ALTER TABLE "team_messages" ADD COLUMN "executionTarget" JSONB;

CREATE TABLE "ai_devices" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "sessionVersion" INTEGER NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_devices_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_devices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ai_devices_tokenHash_key" ON "ai_devices"("tokenHash");
CREATE INDEX "ai_devices_userId_idx" ON "ai_devices"("userId");

CREATE TABLE "ai_device_pairings" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "codeHash" TEXT NOT NULL,
  "sessionVersion" INTEGER NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ai_device_pairings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_device_pairings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ai_device_pairings_userId_key" ON "ai_device_pairings"("userId");
CREATE UNIQUE INDEX "ai_device_pairings_codeHash_key" ON "ai_device_pairings"("codeHash");

CREATE TABLE "user_ai_preferences" (
  "userId" UUID NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'PROJECT',
  "deviceId" UUID,
  "model" TEXT,
  CONSTRAINT "user_ai_preferences_pkey" PRIMARY KEY ("userId"),
  CONSTRAINT "user_ai_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "user_ai_preferences_shape" CHECK (
    ("source" IN ('PROJECT', 'PROVIDERS') AND "deviceId" IS NULL AND "model" IS NULL)
    OR ("source" = 'VM' AND "deviceId" IS NULL AND "model" IS NOT NULL)
    OR ("source" = 'DEVICE' AND "deviceId" IS NOT NULL AND "model" IS NOT NULL)
  )
);
