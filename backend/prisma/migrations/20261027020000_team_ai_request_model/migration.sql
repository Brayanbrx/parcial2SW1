BEGIN;
ALTER TABLE "team_messages" ADD COLUMN "requestModel" JSONB;
ALTER TABLE "team_messages" ADD CONSTRAINT "team_messages_request_model_check"
  CHECK ("requestModel" IS NULL OR ("authorKind" = 'USER' AND jsonb_typeof("requestModel") = 'object'));
CREATE INDEX "team_messages_boardId_status_authorId_idx" ON "team_messages" ("boardId", "status", "authorId");
COMMIT;
