/**
 * Envio de correo, detras de un puerto (mismo patron que la capa de IA,
 * ADR-015).
 *
 * La recuperacion de contrasena necesita entregar un enlace, y eso arrastra un
 * proveedor externo al camino critico. Ponerlo detras de un puerto evita las dos
 * cosas que salen mal:
 *
 *   - que la plataforma no arranque sin una cuenta de correo configurada;
 *   - que cambiar de proveedor obligue a tocar la ruta de recuperacion.
 *
 * El adaptador por defecto es `log`: escribe el mensaje en el registro del
 * servidor. No es un hueco por rellenar — es lo que permite probar el flujo
 * entero, y en una demostracion sin internet sigue habiendo forma de recuperar
 * una cuenta leyendo el registro.
 */

export interface Correo {
  readonly to: string;
  readonly subject: string;
  /** Cuerpo en texto plano. No se envia HTML: un enlace no lo necesita. */
  readonly text: string;
}

export interface MailPort {
  readonly name: string;
  send(correo: Correo): Promise<void>;
}

/** El proveedor no acepto el mensaje. Nunca se le cuenta al usuario final. */
export class MailDeliveryError extends Error {
  public constructor(
    public readonly provider: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'MailDeliveryError';
  }
}

export interface MailConfig {
  readonly provider: 'log' | 'brevo';
  readonly from: string;
  readonly fromName: string;
  readonly brevoApiKey?: string | undefined;
  readonly timeoutMs?: number;
}

export function createMailPort(
  config: MailConfig,
  logger: { info: (obj: unknown, mensaje: string) => void },
): MailPort {
  if (config.provider === 'brevo') return new BrevoMailPort(config);
  return new LogMailPort(logger);
}

/**
 * Escribe el correo en el registro del servidor.
 *
 * Con el enlace completo: es lo que hace utilizable la recuperacion en local y
 * en una red sin salida a internet. `docker logs plataforma-uml-api-1` y ahi
 * esta el enlace.
 */
class LogMailPort implements MailPort {
  public readonly name = 'log';

  public constructor(private readonly logger: { info: (obj: unknown, mensaje: string) => void }) {}

  public send(correo: Correo): Promise<void> {
    this.logger.info(
      { destinatario: correo.to, asunto: correo.subject, cuerpo: correo.text },
      'correo simulado (proveedor: log)',
    );
    return Promise.resolve();
  }
}

/**
 * Brevo, por su API HTTP.
 *
 * Se llama con `fetch` y no con su SDK, por lo mismo que los adaptadores de IA:
 * una peticion no justifica una dependencia con su propia cadencia de versiones.
 */
class BrevoMailPort implements MailPort {
  public readonly name = 'brevo';
  private static readonly URL = 'https://api.brevo.com/v3/smtp/email';

  public constructor(private readonly config: MailConfig) {
    if (config.brevoApiKey === undefined || config.brevoApiKey.trim().length === 0) {
      // Al construir y no en el primer envio: enterarse de que falta la clave
      // cuando alguien ya perdio su contrasena es tarde.
      throw new Error(
        'El proveedor brevo necesita BREVO_API_KEY. Deja MAIL_PROVIDER=log si no la tienes.',
      );
    }
  }

  public async send(correo: Correo): Promise<void> {
    let respuesta: Response;

    try {
      respuesta = await fetch(BrevoMailPort.URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'api-key': this.config.brevoApiKey as string,
        },
        body: JSON.stringify({
          sender: { email: this.config.from, name: this.config.fromName },
          to: [{ email: correo.to }],
          subject: correo.subject,
          textContent: correo.text,
        }),
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 10_000),
      });
    } catch (error) {
      throw new MailDeliveryError('brevo', 'No se pudo contactar con el proveedor.', {
        cause: error,
      });
    }

    if (!respuesta.ok) {
      const detalle = (await respuesta.text().catch(() => '')).slice(0, 300);
      throw new MailDeliveryError(
        'brevo',
        `El proveedor rechazo el envio (${respuesta.status}): ${detalle}`,
      );
    }
  }
}
