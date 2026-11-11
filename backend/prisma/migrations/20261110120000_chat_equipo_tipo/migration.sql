-- Mensajes entre personas del equipo (la IA no los responde).
-- Va en su propia migración: PostgreSQL no permite usar un valor de enum en la
-- misma transacción que lo agrega, y la siguiente lo usa en un CHECK.
-- AlterEnum
ALTER TYPE "TeamMessageKind" ADD VALUE 'CHAT';
