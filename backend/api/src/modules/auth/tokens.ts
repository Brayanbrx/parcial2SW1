import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

/**
 * Tokens de sesion
 * Token de acceso de vida corta mas token de refresco rotativo
 * El de acceso es el que se pasa al abrir el WebSocket
 */

export interface AccessTokenClaims {
  readonly userId: string;
  readonly email: string;
  readonly sessionVersion?: number;
}

export interface TokenIssuer {
  signAccessToken(claims: AccessTokenClaims): Promise<string>;
  verifyAccessToken(token: string): Promise<AccessTokenClaims>;
}

export class InvalidTokenError extends Error {
  public constructor(message = 'El token no es valido o expiro.') {
    super(message);
    this.name = 'InvalidTokenError';
  }
}

const ISSUER = 'plataforma-uml';
const AUDIENCE = 'plataforma-uml-clients';

export function createTokenIssuer(secret: string, accessTtlSeconds: number): TokenIssuer {
  const key = new TextEncoder().encode(secret);

  return {
    async signAccessToken(claims) {
      return new SignJWT({
        email: claims.email,
        sessionVersion: claims.sessionVersion ?? 0,
      } satisfies JWTPayload)
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(claims.userId)
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setIssuedAt()
        .setExpirationTime(`${accessTtlSeconds}s`)
        .sign(key);
    },

    async verifyAccessToken(token) {
      let payload: JWTPayload;
      try {
        ({ payload } = await jwtVerify(token, key, {
          issuer: ISSUER,
          audience: AUDIENCE,
          algorithms: ['HS256'],
        }));
      } catch {
        // El motivo exacto no se propaga: distinguir "firma invalida" de
        // "expirado" solo ayuda a quien esta probando tokens.
        throw new InvalidTokenError();
      }

      const userId = payload.sub;
      const email = payload['email'];
      // Los tokens anteriores a la migración pertenecen a la versión inicial
      const sessionVersion = payload['sessionVersion'] ?? 0;
      if (
        typeof userId !== 'string' ||
        typeof email !== 'string' ||
        typeof sessionVersion !== 'number' ||
        !Number.isSafeInteger(sessionVersion) ||
        sessionVersion < 0
      ) {
        throw new InvalidTokenError();
      }

      return { userId, email, sessionVersion };
    },
  };
}

// El token de refresco es un secreto opaco, no un JWT.
export function createRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(48).toString('base64url');
  return { token, hash: hashRefreshToken(token) };
}

// Se guarda el hash, nunca el token. SHA-256 basta aqui
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
