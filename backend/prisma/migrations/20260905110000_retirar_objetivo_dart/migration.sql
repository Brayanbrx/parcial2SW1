-- La generacion deja de emitir la aplicacion Flutter: solo queda el backend
-- Spring Boot, y con el una sola huella por generacion.
--
-- Se borra la columna en lugar de dejarla nula para siempre: una columna que
-- nadie escribe y nadie lee es una pregunta abierta para quien lea el esquema
-- dentro de un mes. El historial de generaciones anteriores conserva su
-- `springSha256`, que es lo unico que hoy se puede volver a emitir.
ALTER TABLE "generations" DROP COLUMN IF EXISTS "dartSha256";
