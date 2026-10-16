-- Un lote es una entrada de auditoria, y reintentar el registro tras un corte de
-- red no puede duplicarla. El lote ya es la unidad transaccional del dominio
-- (RA-03); aqui pasa a ser tambien la unidad de identidad, para que la ruta de
-- registro pueda ser idempotente.

-- DropIndex
DROP INDEX "audit_operations_batchId_idx";

-- CreateIndex
CREATE UNIQUE INDEX "audit_operations_batchId_key" ON "audit_operations"("batchId");
