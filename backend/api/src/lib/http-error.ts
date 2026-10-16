/**
 * Errores con codigo de estado.
 *
 * El manejador global los traduce a un cuerpo uniforme. Cualquier otra excepcion
 * sale como 500 y se registra entera: si un fallo inesperado se disfrazara de
 * error de cliente, nadie lo veria en los registros.
 */
export class HttpError extends Error {
  public constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const badRequest = (code: string, message: string, details?: unknown): HttpError =>
  new HttpError(400, code, message, details);

export const unauthorized = (message = 'Credenciales invalidas o sesion expirada.'): HttpError =>
  new HttpError(401, 'unauthorized', message);

export const forbidden = (message = 'No tienes permiso para esta operacion.'): HttpError =>
  new HttpError(403, 'forbidden', message);

export const notFound = (message = 'El recurso no existe.'): HttpError =>
  new HttpError(404, 'not_found', message);

export const conflict = (code: string, message: string): HttpError =>
  new HttpError(409, code, message);
