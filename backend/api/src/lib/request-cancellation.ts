import type { FastifyReply, FastifyRequest } from 'fastify';

/** Mantiene viva la llamada mientras el cliente espera la respuesta, no solo
 * mientras sube el cuerpo. IncomingMessage.close también ocurre al terminar
 * de leer un POST normal, por eso se observa el cierre de la respuesta. */
export async function withRequestCancellation<T>(
  request: FastifyRequest,
  reply: FastifyReply,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const onClose = () => {
    if (!reply.raw.writableEnded) abort();
  };
  request.raw.once('aborted', abort);
  reply.raw.once('close', onClose);
  try {
    if (request.raw.aborted || reply.raw.destroyed) abort();
    controller.signal.throwIfAborted();
    return await run(controller.signal);
  } finally {
    request.raw.off('aborted', abort);
    reply.raw.off('close', onClose);
  }
}
