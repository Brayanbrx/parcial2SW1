-- Conversación del equipo: mensajes CHAT entre personas y menciones con @.
-- AlterTable
ALTER TABLE "team_messages" ADD COLUMN "mentions" UUID[] DEFAULT ARRAY[]::UUID[];

-- Prisma no representa CHECK: mantenerlos junto con los contratos compartidos.
-- Un USER es una solicitud a la IA (modo, estado y kind coherentes) o un CHAT:
-- sin modo, estado, error ni modelo UML, y nunca por comando de voz.
ALTER TABLE "team_messages" DROP CONSTRAINT "team_messages_shape_check";
ALTER TABLE "team_messages"
  ADD CONSTRAINT "team_messages_shape_check" CHECK ((
    ("authorKind" = 'USER'
      AND "authorId" IS NOT NULL AND "clientRequestId" IS NOT NULL
      AND "addressedToId" IS NULL AND "inputMode" IS NOT NULL
      AND (("kind" = 'CHAT'
          AND "mode" IS NULL AND "status" IS NULL AND "errorCode" IS NULL
          AND "requestModel" IS NULL AND "inputMode" <> 'VOICE_COMMAND')
        OR ("status" IS NOT NULL
          AND (("mode" = 'ASK' AND "kind" = 'QUESTION')
            OR ("mode" = 'INSTRUCT' AND "kind" = 'INSTRUCTION')
            OR ("mode" = 'REVIEW' AND "kind" = 'REVIEW_REQUEST')))))
    OR
    ("authorKind" IN ('AI', 'SYSTEM')
      AND "authorId" IS NULL AND "clientRequestId" IS NULL AND "mode" IS NULL
      AND "inputMode" IS NULL AND "status" IS NULL AND "errorCode" IS NULL
      AND (("authorKind" = 'SYSTEM' AND "kind" = 'SYSTEM')
        OR ("authorKind" = 'AI' AND ("kind" = 'REVIEW'
          OR ("kind" IN ('ANSWER', 'CLARIFICATION', 'PROPOSAL')
            AND "replyToId" IS NOT NULL AND "addressedToId" IS NOT NULL)))))
  ) IS TRUE),
  -- Solo personas mencionan, hasta 10, sin nulos ni a sí mismas. La pertenencia
  -- al proyecto la comprueba la API: los UUID son referencias históricas.
  ADD CONSTRAINT "team_messages_mentions_check" CHECK ((
    "mentions" IS NOT NULL
    AND cardinality("mentions") <= 10
    AND array_position("mentions", NULL) IS NULL
    AND ("authorKind" = 'USER' OR cardinality("mentions") = 0)
    AND ("authorId" IS NULL OR array_position("mentions", "authorId") IS NULL)
  ) IS TRUE);
