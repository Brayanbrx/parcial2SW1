-- Enlaza cada token de refresco con el que lo sustituyo al rotar.
--
-- Sin este enlace no se puede distinguir «la respuesta de la renovacion no
-- llego al navegador» de «alguien reutiliza un token viejo»: en los dos casos
-- llega un token revocado. Las filas anteriores quedan en NULL y siguen
-- rechazandose, que es el comportamiento que ya tenian.
ALTER TABLE "refresh_tokens" ADD COLUMN "replacedById" UUID;
