import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../src/modules/auth/passwords.js';
import { createRefreshToken, hashRefreshToken } from '../src/modules/auth/tokens.js';

/** RNF-08: contrasenas con derivacion lenta. Nunca cifrado reversible, nunca hash simple. */
describe('derivacion de contrasenas', () => {
  it('acepta la contrasena correcta', async () => {
    const hash = await hashPassword('contrasena-de-prueba');

    await expect(verifyPassword('contrasena-de-prueba', hash)).resolves.toBe(true);
  });

  it('rechaza cualquier otra', async () => {
    const hash = await hashPassword('contrasena-de-prueba');

    await expect(verifyPassword('contrasena-de-pruebA', hash)).resolves.toBe(false);
    await expect(verifyPassword('', hash)).resolves.toBe(false);
  });

  it('no guarda la contrasena en el hash', async () => {
    const hash = await hashPassword('cadena-muy-reconocible');

    expect(hash).not.toContain('cadena-muy-reconocible');
  });

  it('dos hash de la misma contrasena son distintos', async () => {
    // Sal aleatoria: sin ella, dos usuarios con la misma contrasena tendrian el
    // mismo hash y una tabla precalculada los rompe a los dos de una vez.
    const [primero, segundo] = await Promise.all([
      hashPassword('la misma'),
      hashPassword('la misma'),
    ]);

    expect(primero).not.toBe(segundo);
  });

  it('lleva sus parametros dentro para poder subirlos despues', async () => {
    const hash = await hashPassword('cualquiera');
    const [algoritmo, coste] = hash.split('$');

    expect(algoritmo).toBe('scrypt');
    expect(Number(coste)).toBeGreaterThanOrEqual(2 ** 16);
  });

  it('normaliza la forma unicode antes de derivar', async () => {
    // La misma letra escrita como caracter compuesto o descompuesto tiene bytes
    // distintos. Sin normalizar, un teclado de macOS y uno de Windows produciran
    // hash distintos para lo que el usuario ve como la misma contrasena.
    const compuesta = 'contraseña';
    const descompuesta = 'contraseña';

    const hash = await hashPassword(compuesta);
    await expect(verifyPassword(descompuesta, hash)).resolves.toBe(true);
  });

  it('no revienta con un hash corrupto', async () => {
    await expect(verifyPassword('x', 'esto-no-es-un-hash')).resolves.toBe(false);
    await expect(verifyPassword('x', 'bcrypt$1$2$3$4$5')).resolves.toBe(false);
    await expect(verifyPassword('x', '')).resolves.toBe(false);
  });
});

describe('tokens de refresco', () => {
  it('son opacos y no se repiten', () => {
    const primero = createRefreshToken();
    const segundo = createRefreshToken();

    expect(primero.token).not.toBe(segundo.token);
    expect(primero.token.length).toBeGreaterThanOrEqual(43);
  });

  it('se guarda el hash, nunca el token', () => {
    const { token, hash } = createRefreshToken();

    expect(hash).not.toContain(token);
    expect(hash).toBe(hashRefreshToken(token));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
