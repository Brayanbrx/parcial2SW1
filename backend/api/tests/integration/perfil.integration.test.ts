import { createHash, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from '../support/harness.js';

/**
 * Perfil, cambio de contrasena y recuperacion (RF-A10 y RF-A11).
 *
 * Lo que se prueba aqui no es que los formularios respondan 200: es que las tres
 * promesas de seguridad se cumplan. Cambiar la contrasena cierra las demas
 * sesiones, pedir recuperacion no revela si el correo existe, y un enlace de
 * recuperacion sirve una vez.
 */
describe('perfil y contrasena', () => {
  let api: Harness;

  /** Un PNG de 1x1, que es lo mas pequeno que un navegador puede producir. */
  const PNG =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  beforeAll(async () => {
    api = await startHarness();
  }, 180_000);

  afterAll(async () => {
    await api?.stop();
  });

  // -------------------------------------------------------------------------
  // Perfil
  // -------------------------------------------------------------------------

  describe('datos basicos', () => {
    it('cambia el nombre visible', async () => {
      const cuenta = await api.signUp('perfil-nombre@example.com');

      const respuesta = await api.request('PATCH', '/auth/me', {
        token: cuenta.token,
        body: { displayName: 'Ana Actualizada' },
      });

      expect(respuesta.status).toBe(200);
      expect(respuesta.body).toMatchObject({ displayName: 'Ana Actualizada' });

      // Y persiste: la siguiente lectura lo trae.
      const yo = await api.request('GET', '/auth/me', { token: cuenta.token });
      expect(yo.body.displayName).toBe('Ana Actualizada');
    });

    it('no acepta un nombre vacio', async () => {
      const cuenta = await api.signUp('perfil-vacio@example.com');

      const respuesta = await api.request('PATCH', '/auth/me', {
        token: cuenta.token,
        body: { displayName: '   ' },
      });

      expect(respuesta.status).toBe(400);
    });

    it('sin sesion no se puede tocar el perfil', async () => {
      const respuesta = await api.request('PATCH', '/auth/me', {
        body: { displayName: 'Intruso' },
      });

      expect(respuesta.status).toBe(401);
    });

    it('el correo no se puede cambiar por esta ruta', async () => {
      // Es la identidad de la cuenta y la clave de la recuperacion: cambiarlo
      // sin verificar el nuevo buzon permitiria apropiarse de una cuenta.
      const cuenta = await api.signUp('perfil-correo@example.com');

      await api.request('PATCH', '/auth/me', {
        token: cuenta.token,
        body: { displayName: 'Ana', email: 'otro@example.com' },
      });

      const yo = await api.request('GET', '/auth/me', { token: cuenta.token });
      expect(yo.body.email).toBe('perfil-correo@example.com');
    });
  });

  describe('foto de perfil', () => {
    it('sube, sirve y borra la foto', async () => {
      const cuenta = await api.signUp('perfil-foto@example.com');

      const subida = await api.request('PUT', '/auth/me/avatar', {
        token: cuenta.token,
        body: { image: PNG, mediaType: 'image/png' },
      });
      expect(subida.status).toBe(200);
      expect(subida.body.hasAvatar).toBe(true);

      const descarga = await api.raw('GET', `/auth/users/${cuenta.userId}/avatar`, {
        token: cuenta.token,
      });
      expect(descarga.status).toBe(200);
      expect(String(descarga.headers['content-type'])).toContain('image/png');
      // Los ocho primeros bytes de un PNG son su firma.
      expect(descarga.body.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));

      const borrado = await api.request('DELETE', '/auth/me/avatar', { token: cuenta.token });
      expect(borrado.status).toBe(204);

      const despues = await api.request('GET', `/auth/users/${cuenta.userId}/avatar`, {
        token: cuenta.token,
      });
      expect(despues.status).toBe(404);
    });

    it('rechaza un formato que no es imagen', async () => {
      const cuenta = await api.signUp('perfil-formato@example.com');

      const respuesta = await api.request('PUT', '/auth/me/avatar', {
        token: cuenta.token,
        body: { image: PNG, mediaType: 'application/pdf' },
      });

      expect(respuesta.status).toBe(400);
    });

    it('la foto se sirve sin sesion, y un identificador inventado no dice nada', async () => {
      // Una etiqueta <img> pide la imagen con cookies, no con la cabecera
      // Authorization: exigir el token hacia que la foto no se viera nunca. La
      // proteccion es el identificador, que no se publica.
      const cuenta = await api.signUp('perfil-publico@example.com');
      await api.request('PUT', '/auth/me/avatar', {
        token: cuenta.token,
        body: { image: PNG, mediaType: 'image/png' },
      });

      const sinSesion = await api.raw('GET', `/auth/users/${cuenta.userId}/avatar`);
      expect(sinSesion.status).toBe(200);

      // Y no revela quien existe: un identificador inventado responde igual que
      // uno real sin foto.
      const inventado = await api.request(
        'GET',
        '/auth/users/00000000-0000-4000-8000-000000000000/avatar',
      );
      expect(inventado.status).toBe(404);
    });

    it('quien no tiene foto devuelve 404, no una imagen rota', async () => {
      const cuenta = await api.signUp('perfil-sinfoto@example.com');

      const respuesta = await api.request('GET', `/auth/users/${cuenta.userId}/avatar`, {
        token: cuenta.token,
      });

      expect(respuesta.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  // Cambio de contrasena
  // -------------------------------------------------------------------------

  describe('cambiar la contrasena', () => {
    it('revoca inmediatamente los JWT anteriores y conserva la renovacion de la cuenta actual', async () => {
      const account = await api.signUp('revocacion-jwt@example.com', 'contrasena-vieja');
      const other = await api.request('POST', '/auth/login', {
        body: { email: 'revocacion-jwt@example.com', password: 'contrasena-vieja' },
      });
      const changed = await api.request('POST', '/auth/me/password', {
        token: account.token,
        cookie: account.cookie,
        body: { currentPassword: 'contrasena-vieja', newPassword: 'contrasena-nueva' },
      });
      expect(changed.status).toBe(200);
      expect((await api.request('GET', '/auth/me', { token: other.body.accessToken })).status).toBe(
        401,
      );
      expect(
        (
          await api.request('POST', '/projects', {
            token: other.body.accessToken,
            body: { displayName: 'Acceso revocado' },
          })
        ).status,
      ).toBe(401);
      const refresh = await api.request('POST', '/auth/refresh', { cookie: account.cookie });
      expect(refresh.status).toBe(200);
      expect(
        (await api.request('GET', '/auth/me', { token: refresh.body.accessToken })).status,
      ).toBe(200);
      const cookie = other.cookies.find((c) => c.name === 'uml_refresh')!;
      expect(
        (await api.request('POST', '/auth/refresh', { cookie: `${cookie.name}=${cookie.value}` }))
          .status,
      ).toBe(401);
    });
    it('exige la actual y deja entrar con la nueva', async () => {
      const cuenta = await api.signUp('cambio-ok@example.com', 'contrasena-vieja');

      const respuesta = await api.request('POST', '/auth/me/password', {
        token: cuenta.token,
        body: { currentPassword: 'contrasena-vieja', newPassword: 'contrasena-nueva' },
      });
      expect(respuesta.status).toBe(200);

      const conVieja = await api.request('POST', '/auth/login', {
        body: { email: 'cambio-ok@example.com', password: 'contrasena-vieja' },
      });
      expect(conVieja.status).toBe(401);

      const conNueva = await api.request('POST', '/auth/login', {
        body: { email: 'cambio-ok@example.com', password: 'contrasena-nueva' },
      });
      expect(conNueva.status).toBe(200);
    });

    it('rechaza si la contrasena actual no es la que se dice', async () => {
      const cuenta = await api.signUp('cambio-mal@example.com', 'contrasena-vieja');

      const respuesta = await api.request('POST', '/auth/me/password', {
        token: cuenta.token,
        body: { currentPassword: 'la-que-no-es', newPassword: 'contrasena-nueva' },
      });

      expect(respuesta.status).toBe(401);
    });

    it('cierra las demas sesiones', async () => {
      // Es la razon de ser del cambio: quien lo hace porque cree que otra
      // persona la sabe espera que esa persona quede fuera.
      const cuenta = await api.signUp('cambio-sesiones@example.com', 'contrasena-vieja');

      const otraSesion = await api.request('POST', '/auth/login', {
        body: { email: 'cambio-sesiones@example.com', password: 'contrasena-vieja' },
      });
      const cookieAjena = otraSesion.cookies.find((item) => item.name === 'uml_refresh');
      expect(cookieAjena).toBeDefined();

      await api.request('POST', '/auth/me/password', {
        token: cuenta.token,
        body: { currentPassword: 'contrasena-vieja', newPassword: 'contrasena-nueva' },
      });

      const renovar = await api.request('POST', '/auth/refresh', {
        cookie: `uml_refresh=${cookieAjena?.value ?? ''}`,
      });
      expect(renovar.status).toBe(401);
    });
  });

  // -------------------------------------------------------------------------
  // Recuperacion
  // -------------------------------------------------------------------------

  describe('recuperar la contrasena', () => {
    it('restablecer invalida el acceso JWT sin esperar su caducidad', async () => {
      const account = await api.signUp('reset-jwt@example.com');
      const token = await sembrarEnlace(account.userId);
      expect(
        (
          await api.request('POST', '/auth/password/reset', {
            body: { token, newPassword: 'otra-contrasena-segura' },
          })
        ).status,
      ).toBe(200);
      expect((await api.request('GET', '/auth/me', { token: account.token })).status).toBe(401);
      expect((await api.request('POST', '/auth/refresh', { cookie: account.cookie })).status).toBe(
        401,
      );
    });
    /**
     * Siembra un enlace valido con un testigo conocido.
     *
     * La prueba no puede leer el testigo de la base —la ruta guarda solo su
     * hash, que es justamente la propiedad que interesa— ni del correo, que no
     * sale de la maquina. Asi que se crea el registro con un secreto conocido y
     * su hash, exactamente como lo haria la ruta.
     */
    async function sembrarEnlace(
      userId: string,
      opciones: { expiresAt?: Date } = {},
    ): Promise<string> {
      const testigo = randomBytes(48).toString('base64url');

      await api.app.prisma.passwordReset.create({
        data: {
          userId,
          tokenHash: createHash('sha256').update(testigo).digest('hex'),
          expiresAt: opciones.expiresAt ?? new Date(Date.now() + 60 * 60 * 1000),
        },
      });

      return testigo;
    }

    it('responde igual exista o no la cuenta', async () => {
      await api.signUp('recupera-existe@example.com');

      const existe = await api.request('POST', '/auth/password/forgot', {
        body: { email: 'recupera-existe@example.com' },
      });
      const noExiste = await api.request('POST', '/auth/password/forgot', {
        body: { email: 'nadie-por-aqui@example.com' },
      });

      // Mismo codigo y mismo cuerpo: el formulario no puede servir para
      // averiguar que correos estan registrados.
      expect(existe.status).toBe(202);
      expect(existe.status).toBe(noExiste.status);
      expect(JSON.stringify(existe.body)).toBe(JSON.stringify(noExiste.body));
    });

    it('solo crea un registro para una cuenta real, y guarda el hash', async () => {
      await api.signUp('recupera-registro@example.com');
      await api.request('POST', '/auth/password/forgot', {
        body: { email: 'recupera-registro@example.com' },
      });
      await api.request('POST', '/auth/password/forgot', {
        body: { email: 'tampoco-existe@example.com' },
      });

      const fila = await api.app.prisma.passwordReset.findFirst({
        where: { user: { email: 'recupera-registro@example.com' } },
      });
      const inventado = await api.app.prisma.passwordReset.count({
        where: { user: { email: 'tampoco-existe@example.com' } },
      });

      expect(inventado).toBe(0);
      // 64 hexadecimales: es un SHA-256, no el secreto que viaja en el enlace.
      expect(fila?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('restablece la contrasena y deja entrar con la nueva', async () => {
      const cuenta = await api.signUp('recupera-flujo@example.com', 'contrasena-vieja');
      const testigo = await sembrarEnlace(cuenta.userId);

      const respuesta = await api.request('POST', '/auth/password/reset', {
        body: { token: testigo, newPassword: 'contrasena-nueva' },
      });
      expect(respuesta.status).toBe(200);

      const conNueva = await api.request('POST', '/auth/login', {
        body: { email: 'recupera-flujo@example.com', password: 'contrasena-nueva' },
      });
      expect(conNueva.status).toBe(200);
    });

    it('el enlace sirve una sola vez', async () => {
      const cuenta = await api.signUp('recupera-unico@example.com');
      const testigo = await sembrarEnlace(cuenta.userId);

      const primera = await api.request('POST', '/auth/password/reset', {
        body: { token: testigo, newPassword: 'contrasena-nueva' },
      });
      const segunda = await api.request('POST', '/auth/password/reset', {
        body: { token: testigo, newPassword: 'otra-contrasena' },
      });

      expect(primera.status).toBe(200);
      expect(segunda.status).toBe(400);
    });

    it('un enlace caducado no sirve', async () => {
      const cuenta = await api.signUp('recupera-caducado@example.com');
      const testigo = await sembrarEnlace(cuenta.userId, {
        expiresAt: new Date(Date.now() - 1000),
      });

      const respuesta = await api.request('POST', '/auth/password/reset', {
        body: { token: testigo, newPassword: 'contrasena-nueva' },
      });

      expect(respuesta.status).toBe(400);
      expect(respuesta.body.error.code).toBe('enlace_invalido');
    });

    it.each([false, true])(
      'solo una recuperacion simultanea cambia la clave (enlaces distintos: %s)',
      async (distintos) => {
        const email = `recupera-carrera-${distintos}@example.com`;
        const cuenta = await api.signUp(email);
        const primero = await sembrarEnlace(cuenta.userId);
        const segundo = distintos ? await sembrarEnlace(cuenta.userId) : primero;
        const claves = ['contrasena-primera', 'contrasena-segunda'];
        const respuestas = await Promise.all(
          [primero, segundo].map((token, index) =>
            api.request('POST', '/auth/password/reset', {
              body: { token, newPassword: claves[index] },
            }),
          ),
        );
        expect(respuestas.map((r) => r.status).sort()).toEqual([200, 400]);
        const ganadora = respuestas.findIndex((r) => r.status === 200);
        const acceso = await api.request('POST', '/auth/login', {
          body: { email, password: claves[ganadora] },
        });
        expect(acceso.status).toBe(200);
      },
    );

    it('cambiar la contrasena invalida enlaces de recuperacion anteriores', async () => {
      const cuenta = await api.signUp('recupera-anterior@example.com', 'contrasena-vieja');
      const token = await sembrarEnlace(cuenta.userId);
      const cambio = await api.request('POST', '/auth/me/password', {
        token: cuenta.token,
        body: { currentPassword: 'contrasena-vieja', newPassword: 'contrasena-nueva' },
      });
      expect(cambio.status).toBe(200);
      const intento = await api.request('POST', '/auth/password/reset', {
        body: { token, newPassword: 'contrasena-intruso' },
      });
      expect(intento.status).toBe(400);
    });

    it('restablecer cierra todas las sesiones abiertas', async () => {
      // Quien restablece perdio el acceso; puede que otra persona tenga una
      // sesion abierta con la contrasena vieja.
      const cuenta = await api.signUp('recupera-sesiones@example.com');
      const testigo = await sembrarEnlace(cuenta.userId);

      await api.request('POST', '/auth/password/reset', {
        body: { token: testigo, newPassword: 'contrasena-nueva' },
      });

      const renovar = await api.request('POST', '/auth/refresh', {
        cookie: `uml_refresh=${cuenta.cookie}`,
      });
      expect(renovar.status).toBe(401);
    });

    it('un testigo invalido no restablece nada', async () => {
      const respuesta = await api.request('POST', '/auth/password/reset', {
        body: { token: 'a'.repeat(64), newPassword: 'contrasena-nueva' },
      });

      expect(respuesta.status).toBe(400);
      expect(respuesta.body.error.code).toBe('enlace_invalido');
    });
  });
});
