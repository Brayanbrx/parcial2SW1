-- Migracion aditiva y atomica: conserva las tablas y datos del primer parcial.
BEGIN;

-- CreateEnum
CREATE TYPE "TeamAuthorKind" AS ENUM ('USER', 'AI', 'SYSTEM');

-- CreateEnum
CREATE TYPE "TeamMode" AS ENUM ('ASK', 'INSTRUCT', 'REVIEW');

-- CreateEnum
CREATE TYPE "TeamInputMode" AS ENUM ('TEXT', 'DICTATION', 'VOICE_COMMAND');

-- CreateEnum
CREATE TYPE "TeamMessageKind" AS ENUM ('QUESTION', 'INSTRUCTION', 'REVIEW_REQUEST', 'ANSWER', 'CLARIFICATION', 'PROPOSAL', 'REVIEW', 'SYSTEM');

-- CreateEnum
CREATE TYPE "TeamRequestStatus" AS ENUM ('QUEUED', 'PROCESSING', 'DONE', 'FAILED', 'CANCELLED', 'INTERRUPTED');

-- CreateEnum
CREATE TYPE "AiProposalStatus" AS ENUM ('READY', 'PENDING_CONFIRMATION', 'APPLIED', 'STALE', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AiRejectReason" AS ENUM ('USER', 'STALE', 'APPLY_FAILED');

-- CreateEnum
CREATE TYPE "AiSolutionMode" AS ENUM ('HINTS_ONLY', 'ON_REQUEST');

-- CreateEnum
CREATE TYPE "AiExecutionMode" AS ENUM ('PROPOSE_ONLY', 'AUTO_SAFE_VOICE', 'AUTO_SAFE_ALL');

-- CreateEnum
CREATE TYPE "AiReviewMode" AS ENUM ('OFF', 'ON_DEMAND', 'ON_ISSUES');

-- CreateTable
CREATE TABLE "project_ai_settings" (
    "projectId" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "solutionMode" "AiSolutionMode" NOT NULL DEFAULT 'ON_REQUEST',
    "executionMode" "AiExecutionMode" NOT NULL DEFAULT 'AUTO_SAFE_VOICE',
    "reviewMode" "AiReviewMode" NOT NULL DEFAULT 'ON_ISSUES',
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "project_ai_settings_pkey" PRIMARY KEY ("projectId")
);

-- CreateTable
CREATE TABLE "team_messages" (
    "id" UUID NOT NULL,
    "boardId" UUID NOT NULL,
    "authorKind" "TeamAuthorKind" NOT NULL,
    "authorId" UUID,
    "addressedToId" UUID,
    "replyToId" UUID,
    "clientRequestId" UUID,
    "mode" "TeamMode",
    "inputMode" "TeamInputMode",
    "kind" "TeamMessageKind" NOT NULL,
    "text" TEXT NOT NULL,
    "status" "TeamRequestStatus",
    "errorCode" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "team_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_proposals" (
    "id" UUID NOT NULL,
    "boardId" UUID NOT NULL,
    "requestMessageId" UUID NOT NULL,
    "requesterId" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "batch" JSONB NOT NULL,
    "expectedSemantic" JSONB NOT NULL,
    "status" "AiProposalStatus" NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "rejectReason" "AiRejectReason",
    "decidedAt" TIMESTAMPTZ(3),
    "decidedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ai_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_review_states" (
    "boardId" UUID NOT NULL,
    "lastReviewedBatchId" UUID,
    "lastIssueKeys" JSONB NOT NULL DEFAULT '[]',
    "lastReviewAt" TIMESTAMPTZ(3),
    "lastInterventionAt" TIMESTAMPTZ(3),

    CONSTRAINT "ai_review_states_pkey" PRIMARY KEY ("boardId")
);

-- CreateIndex
CREATE UNIQUE INDEX "team_messages_clientRequestId_key" ON "team_messages"("clientRequestId");

-- CreateIndex
CREATE INDEX "team_messages_boardId_createdAt_id_idx" ON "team_messages"("boardId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "team_messages_boardId_updatedAt_id_idx" ON "team_messages"("boardId", "updatedAt", "id");

-- CreateIndex
CREATE INDEX "team_messages_boardId_authorId_createdAt_idx" ON "team_messages"("boardId", "authorId", "createdAt");

-- CreateIndex
CREATE INDEX "team_messages_boardId_addressedToId_createdAt_idx" ON "team_messages"("boardId", "addressedToId", "createdAt");

-- CreateIndex
CREATE INDEX "team_messages_boardId_replyToId_idx" ON "team_messages"("boardId", "replyToId");

-- CreateIndex
CREATE UNIQUE INDEX "team_messages_boardId_id_key" ON "team_messages"("boardId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_proposals_requestMessageId_key" ON "ai_proposals"("requestMessageId");

-- CreateIndex
CREATE INDEX "ai_proposals_boardId_updatedAt_id_idx" ON "ai_proposals"("boardId", "updatedAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_proposals_boardId_requestMessageId_key" ON "ai_proposals"("boardId", "requestMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "ai_proposals_boardId_batchId_key" ON "ai_proposals"("boardId", "batchId");

-- AddForeignKey
ALTER TABLE "project_ai_settings" ADD CONSTRAINT "project_ai_settings_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_messages" ADD CONSTRAINT "team_messages_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "boards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_messages" ADD CONSTRAINT "team_messages_boardId_replyToId_fkey" FOREIGN KEY ("boardId", "replyToId") REFERENCES "team_messages"("boardId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ai_proposals" ADD CONSTRAINT "ai_proposals_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "boards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_proposals" ADD CONSTRAINT "ai_proposals_boardId_requestMessageId_fkey" FOREIGN KEY ("boardId", "requestMessageId") REFERENCES "team_messages"("boardId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_review_states" ADD CONSTRAINT "ai_review_states_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "boards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Prisma no representa CHECK: mantenerlos junto con los contratos compartidos.
-- La validacion completa del contenido JSON corresponde a la API.
ALTER TABLE "team_messages"
  ADD CONSTRAINT "team_messages_shape_check" CHECK ((
    ("authorKind" = 'USER'
      AND "authorId" IS NOT NULL AND "clientRequestId" IS NOT NULL
      AND "addressedToId" IS NULL AND "inputMode" IS NOT NULL AND "status" IS NOT NULL
      AND (("mode" = 'ASK' AND "kind" = 'QUESTION')
        OR ("mode" = 'INSTRUCT' AND "kind" = 'INSTRUCTION')
        OR ("mode" = 'REVIEW' AND "kind" = 'REVIEW_REQUEST')))
    OR
    ("authorKind" IN ('AI', 'SYSTEM')
      AND "authorId" IS NULL AND "clientRequestId" IS NULL AND "mode" IS NULL
      AND "inputMode" IS NULL AND "status" IS NULL AND "errorCode" IS NULL
      AND (("authorKind" = 'SYSTEM' AND "kind" = 'SYSTEM')
        OR ("authorKind" = 'AI' AND ("kind" = 'REVIEW'
          OR ("kind" IN ('ANSWER', 'CLARIFICATION', 'PROPOSAL')
            AND "replyToId" IS NOT NULL AND "addressedToId" IS NOT NULL)))))
  ) IS TRUE),
  ADD CONSTRAINT "team_messages_text_check" CHECK (length("text") > 0),
  ADD CONSTRAINT "team_messages_time_check" CHECK ("updatedAt" >= "createdAt");

ALTER TABLE "ai_proposals"
  ADD CONSTRAINT "ai_proposals_expiry_check" CHECK ("expiresAt" = "createdAt" + interval '15 minutes'),
  ADD CONSTRAINT "ai_proposals_time_check" CHECK ("updatedAt" >= "createdAt"),
  ADD CONSTRAINT "ai_proposals_decider_check" CHECK ("decidedById" IS NULL OR "decidedById" = "requesterId"),
  ADD CONSTRAINT "ai_proposals_reason_check" CHECK ((
    ("status" = 'STALE' AND "rejectReason" = 'STALE')
    OR ("status" = 'REJECTED' AND "rejectReason" IN ('USER', 'APPLY_FAILED'))
    OR ("status" NOT IN ('STALE', 'REJECTED') AND "rejectReason" IS NULL)
  ) IS TRUE),
  ADD CONSTRAINT "ai_proposals_json_check" CHECK (
    jsonb_typeof("batch") = 'object' AND jsonb_typeof("expectedSemantic") = 'object');

ALTER TABLE "ai_review_states"
  ADD CONSTRAINT "ai_review_states_keys_check" CHECK (jsonb_typeof("lastIssueKeys") = 'array');

COMMIT;
