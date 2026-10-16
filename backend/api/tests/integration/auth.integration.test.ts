import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from '../support/harness.js';

/** RF-A01 a RF-A03: registro, inicio y cierre de sesion, y renovacion. */
describe('sesion', () => {
  let api: Harness;

  beforeAll(async () => {
    api = await startHarness();
  }, 180_000);

  afterAll(async () => {
    await api?.stop();
  });

  it('RF-A01 — registra una cuenta pendiente sin emitir sesión y envía activación', async () => {
    const respuesta = await api.request('POST', '/auth/register', {
      body: { email: 'ana@example.com', displayName: 'Ana', password: 'contrasena-larga' },
    });

    expect(respuesta.status).toBe(201);
    expect(respuesta.body).toEqual({ verificationRequired: true, emailSent: true });
    expect(respuesta.cookies).toHaveLength(0);
    const denied = await api.request('POST', '/auth/login', {
      body: { email: 'ana@example.com', password: 'contrasena-larga' },
    });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('email_not_verified');
    await api.activate('ana@example.com');
  });

  it('nunca devuelve el hash de la contrasena', async () => {
    const respuesta = await api.request('POST', '/auth/register', {
      body: { email: 'sinhash@example.com', displayName: 'Sin Hash', password: 'contrasena-larga' },
    });

    expect(JSON.stringify(respuesta.body)).not.toMatch(/passwordHash|scrypt/);
  });

  it('rechaza un correo ya registrado', async () => {
    const respuesta = await api.request('POST', '/auth/register', {
      body: { email: 'ana@example.com', displayName: 'Otra Ana', password: 'contrasena-larga' },
    });

    expect(respuesta.status).toBe(409);
    expect(respuesta.body.error.code).toBe('email_taken');
  });

  it('conserva el 409 si dos registros del mismo correo llegan juntos', async () => {
    const body = {
      email: 'registro-simultaneo@example.com',
      displayName: 'Registro simultaneo',
      password: 'contrasena-larga',
    };

    const respuestas = await Promise.all([
      api.request('POST', '/auth/register', { body }),
      api.request('POST', '/auth/register', { body }),
    ]);

    expect(respuestas.map(({ status }) => status).sort()).toEqual([201, 409]);
    expect(respuestas.find(({ status }) => status === 409)?.body.error.code).toBe('email_taken');
  });

  it('normaliza el correo a minusculas', async () => {
    const respuesta = await api.request('POST', '/auth/login', {
      body: { email: 'ANA@Example.com', password: 'contrasena-larga' },
    });

    expect(respuesta.status).toBe(200);
  });

  it('RF-A02 — inicia sesion con credenciales correctas', async () => {
    const respuesta = await api.request('POST', '/auth/login', {
      body: { email: 'ana@example.com', password: 'contrasena-larga' },
    });

    expect(respuesta.status).toBe(200);
    expect(typeof respuesta.body.accessToken).toBe('string');
  });

  it('rechaza la contrasena incorrecta sin decir si el correo existe', async () => {
    const conCorreoReal = await api.request('POST', '/auth/login', {
      body: { email: 'ana@example.com', password: 'contrasena-equivocada' },
    });
    const conCorreoInventado = await api.request('POST', '/auth/login', {
      body: { email: 'nadie@example.com', password: 'contrasena-equivocada' },
    });

    expect(conCorreoReal.status).toBe(401);
    expect(conCorreoInventado.status).toBe(401);
    // El mismo mensaje en los dos casos: distinguirlos convierte el inicio de
    // sesion en un comprobador de correos registrados.
    expect(conCorreoReal.body.error.message).toBe(conCorreoInventado.body.error.message);
  });

  it('rechaza una contrasena demasiado corta', async () => {
    const respuesta = await api.request('POST', '/auth/register', {
      body: { email: 'corta@example.com', displayName: 'Corta', password: 'abc' },
    });

    expect(respuesta.status).toBe(400);
    expect(respuesta.body.error.code).toBe('validation_failed');
  });

  it('RF-A03 — renueva la sesion y rota el token de refresco', async () => {
    const registro = await api.signUp('rota@example.com');
    const cookieInicial = registro.cookie;

    const renovacion = await api.request('POST', '/auth/refresh', { cookie: cookieInicial });
    expect(renovacion.status).toBe(200);

    const segunda = renovacion.cookies.find((item) => item.name === 'uml_refresh');
    expect(`uml_refresh=${segunda?.value}`).not.toBe(cookieInicial);

    // En cuanto el sucesor se usa, el cliente legitimo si recibio su respuesta y
    // volver a presentar el token viejo es una reutilizacion.
    const tercera = await api.request('POST', '/auth/refresh', {
      cookie: `uml_refresh=${segunda?.value}`,
    });
    expect(tercera.status).toBe(200);

    const reutilizacion = await api.request('POST', '/auth/refresh', { cookie: cookieInicial });
    expect(reutilizacion.status).toBe(401);
  });

  it('una renovacion cuya respuesta no llego al navegador puede repetirse', async () => {
    const sesion = await api.signUp('renovacion-perdida@example.com');

    // El servidor rota y responde; recargar en ese instante descarta la
    // respuesta y el navegador se queda con el token que acaba de revocarse.
    const perdida = await api.request('POST', '/auth/refresh', { cookie: sesion.cookie });
    expect(perdida.status).toBe(200);

    const reintento = await api.request('POST', '/auth/refresh', { cookie: sesion.cookie });
    expect(reintento.status).toBe(200);

    const entregada = reintento.cookies.find((item) => item.name === 'uml_refresh');
    expect(entregada?.value).toBeDefined();
    const perfil = await api.request('GET', '/auth/me', { token: reintento.body.accessToken });
    expect(perfil.status).toBe(200);
  });

  it('pasado el margen, un token rotado ya no se acepta', async () => {
    const sesion = await api.signUp('margen-vencido@example.com');
    const renovacion = await api.request('POST', '/auth/refresh', { cookie: sesion.cookie });
    expect(renovacion.status).toBe(200);

    // Se envejece la revocacion en lugar de esperar medio minuto real.
    await api.app.prisma.refreshToken.updateMany({
      where: { userId: sesion.userId, revokedAt: { not: null } },
      data: { revokedAt: new Date(Date.now() - 60_000) },
    });

    const tardia = await api.request('POST', '/auth/refresh', { cookie: sesion.cookie });
    expect(tardia.status).toBe(401);
  });

  it('dos peticiones juntas no dejan dos sesiones independientes', async () => {
    const sesion = await api.signUp('carrera-refresh@example.com');

    const respuestas = await Promise.all([
      api.request('POST', '/auth/refresh', { cookie: sesion.cookie }),
      api.request('POST', '/auth/refresh', { cookie: sesion.cookie }),
    ]);

    // Una de las dos puede atenderse por el margen de rotacion —consumiendo el
    // sucesor que la otra no llego a entregar—, asi que ya no se exige un 401.
    // Lo que no cambia: la cadena avanza y el token original queda fuera.
    expect(respuestas.every(({ status }) => [200, 401].includes(status))).toBe(true);
    const ultima = respuestas.findLast(({ status }) => status === 200);
    const entregada = ultima?.cookies.find((item) => item.name === 'uml_refresh');
    expect(
      (await api.request('POST', '/auth/refresh', { cookie: `uml_refresh=${entregada?.value}` }))
        .status,
    ).toBe(200);

    const reutilizacion = await api.request('POST', '/auth/refresh', { cookie: sesion.cookie });
    expect(reutilizacion.status).toBe(401);
  });

  it('cerrar sesion revoca el token de refresco', async () => {
    const sesion = await api.signUp('cierra@example.com');

    const cierre = await api.request('POST', '/auth/logout', { cookie: sesion.cookie });
    expect(cierre.status).toBe(204);

    const renovacion = await api.request('POST', '/auth/refresh', { cookie: sesion.cookie });
    expect(renovacion.status).toBe(401);
  });

  it('protege las rutas que necesitan sesion', async () => {
    expect((await api.request('GET', '/auth/me')).status).toBe(401);
    expect((await api.request('GET', '/auth/me', { token: 'no-es-un-token' })).status).toBe(401);
    expect((await api.request('GET', '/projects')).status).toBe(401);
  });

  it('devuelve el perfil con un token valido', async () => {
    const sesion = await api.signUp('perfil@example.com');
    const respuesta = await api.request('GET', '/auth/me', { token: sesion.token });

    expect(respuesta.status).toBe(200);
    expect(respuesta.body).toMatchObject({ id: sesion.userId, email: 'perfil@example.com' });
  });
});
