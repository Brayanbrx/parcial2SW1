-- La idempotencia pertenece a una pizarra. Un batchId repetido en otra no debe
-- hacer que la API responda 202 sin registrar nada en la pizarra solicitada.
DROP INDEX IF EXISTS "audit_operations_batchId_key";

CREATE UNIQUE INDEX "audit_operations_boardId_batchId_key"
  ON "audit_operations"("boardId", "batchId");
