/**
 * Siembra una cuenta y un proyecto de demostracion contra el entorno levantado.
 *
 * La seccion 16.3 lo pide para el dia 22: "cuentas de prueba creadas y proyecto
 * de demostracion listo". Tambien sirve para probar la plataforma sin tener que
 * registrarse a mano cada vez.
 *
 *   npm run up
 *   npm run seed
 *
 * Es idempotente: si la cuenta ya existe, inicia sesion en lugar de fallar.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const BASE = process.env['SEED_BASE_URL'] ?? 'http://localhost:8080';

const CUENTAS = [
  { email: 'ana@demo.local', displayName: 'Ana', password: 'demo-plataforma-uml' },
  { email: 'beto@demo.local', displayName: 'Beto', password: 'demo-plataforma-uml' },
] as const;

interface Sesion {
  readonly accessToken: string;
  readonly cookie: string;
  readonly user: { id: string; email: string; displayName: string };
}

async function main(): Promise<void> {
  const ana = await cuenta(CUENTAS[0]);
  const beto = await cuenta(CUENTAS[1]);

  const proyecto = await pedir<{ id: string; displayName: string }>('/api/projects', {
    token: ana.accessToken,
    method: 'POST',
    body: { displayName: 'Sistema de Ventas' },
  });

  for (const pizarra of ['Ventas', 'Inventario']) {
    await pedir('/api/projects/' + proyecto.id + '/boards', {
      token: ana.accessToken,
      method: 'POST',
      body: { displayName: pizarra },
    });
  }

  const invitacion = await pedir<{ code: string }>(`/api/projects/${proyecto.id}/invites`, {
    token: ana.accessToken,
    method: 'POST',
    body: { role: 'EDITOR' },
  });
  await pedir(`/api/invites/${invitacion.code}/accept`, {
    token: beto.accessToken,
    method: 'POST',
  });

  console.warn(`
Entorno de demostracion listo en ${BASE}

  Propietaria   ${CUENTAS[0].email}   ${CUENTAS[0].password}
  Editor        ${CUENTAS[1].email}   ${CUENTAS[1].password}

  Proyecto      ${proyecto.displayName}
  Pizarras      Ventas · Inventario

Abre ${BASE} en dos navegadores distintos —o uno normal y otro de incognito—
e inicia sesion con cada cuenta para ver la colaboracion en vivo.
`);
}

async function cuenta(datos: (typeof CUENTAS)[number]): Promise<Sesion> {
  const registro = await intentar('/api/auth/register', {
    email: datos.email,
    displayName: datos.displayName,
    password: datos.password,
  });
  if (registro !== null) return registro;

  // Ya existia, o quedo pendiente de activacion. En los dos casos se intenta
  // entrar: sembrar dos veces no debe fallar.
  const acceso = await intentar('/api/auth/login', {
    email: datos.email,
    password: datos.password,
  });
  if (acceso !== null) return acceso;

  const activada = await activar(datos.email);
  const segundoIntento = activada
    ? await intentar('/api/auth/login', { email: datos.email, password: datos.password })
    : null;
  if (segundoIntento === null) {
    throw new Error(
      `No se pudo crear ni abrir la cuenta ${datos.email}. ` +
        'Activa la cuenta desde el correo (o los logs de API con MAIL_PROVIDER=log) y vuelve a ejecutar npm run seed.',
    );
  }
  return segundoIntento;
}

/**
 * Activa la cuenta con el enlace que la API escribio en su registro.
 *
 * Desde que el registro exige confirmar el correo, sembrar contra una base
 * recien creada terminaba siempre en el error de arriba: `register` devuelve
 * «pendiente de activacion» y `login` responde 403 hasta que alguien copia el
 * enlace a mano. Con `MAIL_PROVIDER=log` —el valor por defecto de la
 * composicion local— ese enlace esta en `docker compose logs api`, asi que se
 * lee de ahi. Con un proveedor real no hay nada que leer y se devuelve `false`:
 * el mensaje de error explica el paso manual.
 */
async function activar(email: string): Promise<boolean> {
  let token = await tokenDeActivacion(email);
  if (token === null) {
    // Un registro anterior pudo salir de la ventana de lineas que se consulta.
    // El reenvio tiene un minuto de espera propio; si no entrega, no hay token.
    await fetch(BASE + '/api/auth/verification/resend', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    }).catch(() => undefined);
    token = await tokenDeActivacion(email);
  }
  if (token === null) return false;

  const respuesta = await fetch(BASE + '/api/auth/verification/confirm', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  return respuesta.ok;
}

async function tokenDeActivacion(email: string): Promise<string | null> {
  // Solo contra la composicion de esta maquina: leer el registro de un servidor
  // remoto no es posible, y su proveedor de correo tampoco seria `log`.
  if (!/^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/|$)/.test(BASE)) return null;

  let salida: string;
  try {
    const resultado = await promisify(execFile)(
      'docker',
      [
        'compose',
        '-f',
        'infra/compose.yml',
        '--env-file',
        'infra/.env',
        'logs',
        '--no-color',
        '--no-log-prefix',
        '--tail',
        '500',
        'api',
      ],
      { maxBuffer: 16 * 1024 * 1024 },
    );
    salida = resultado.stdout;
  } catch {
    return null;
  }

  return (
    salida
      .split(/\r?\n/)
      .flatMap((linea) => {
        try {
          return [JSON.parse(linea) as { destinatario?: string; cuerpo?: string }];
        } catch {
          return [];
        }
      })
      .findLast((correo) => correo.destinatario === email && correo.cuerpo?.includes('/activar#'))
      ?.cuerpo?.match(/#token=(\S+)/)?.[1] ?? null
  );
}

async function intentar(ruta: string, cuerpo: object): Promise<Sesion | null> {
  const respuesta = await fetch(BASE + ruta, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(cuerpo),
  });

  if (!respuesta.ok) return null;

  const datos = (await respuesta.json()) as Omit<Sesion, 'cookie'> & {
    verificationRequired?: boolean;
  };
  if (datos.verificationRequired) return null;
  return { ...datos, cookie: respuesta.headers.get('set-cookie') ?? '' };
}

interface PedirOpciones {
  readonly token: string;
  readonly method?: string;
  readonly body?: object;
}

async function pedir<T>(ruta: string, opciones: PedirOpciones): Promise<T> {
  const respuesta = await fetch(BASE + ruta, {
    method: opciones.method ?? 'GET',
    headers: {
      authorization: `Bearer ${opciones.token}`,
      // Solo se declara JSON cuando hay cuerpo: declararlo sin cuerpo hace que
      // el servidor rechace la peticion antes de mirar la ruta.
      ...(opciones.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(opciones.body === undefined ? {} : { body: JSON.stringify(opciones.body) }),
  });

  if (!respuesta.ok) {
    throw new Error(`${ruta} devolvio ${respuesta.status}: ${await respuesta.text()}`);
  }
  return (await respuesta.json()) as T;
}

await main();
