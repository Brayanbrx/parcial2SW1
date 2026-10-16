import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from '../support/harness.js';

/**
 * RF-A04 a RF-A07 y RF-001 a RF-005: proyectos, membresias, invitaciones y
 * pizarras.
 */
describe('proyectos, membresias y pizarras', () => {
  let api: Harness;
  let duena: Awaited<ReturnType<Harness['signUp']>>;
  let invitado: Awaited<ReturnType<Harness['signUp']>>;
  let extrano: Awaited<ReturnType<Harness['signUp']>>;

  beforeAll(async () => {
    api = await startHarness();
    duena = await api.signUp('duena@example.com');
    invitado = await api.signUp('invitado@example.com');
    extrano = await api.signUp('extrano@example.com');
  }, 180_000);

  afterAll(async () => {
    await api?.stop();
  });

  async function nuevoProyecto(nombre: string): Promise<string> {
    const respuesta = await api.request('POST', '/projects', {
      token: duena.token,
      body: { displayName: nombre },
    });
    expect(respuesta.status).toBe(201);
    return respuesta.body.id as string;
  }

  it('RF-A04 — quien crea el proyecto queda como propietario', async () => {
    const projectId = await nuevoProyecto('Sistema de Ventas');

    const miembros = await api.request('GET', `/projects/${projectId}/members`, {
      token: duena.token,
    });

    expect(miembros.status).toBe(200);
    expect(miembros.body).toHaveLength(1);
    expect(miembros.body[0]).toMatchObject({ id: duena.userId, role: 'OWNER' });
  });

  it('un no miembro recibe 404, no 403', async () => {
    const projectId = await nuevoProyecto('Privado');

    const respuesta = await api.request('GET', `/projects/${projectId}`, { token: extrano.token });

    // Responder "no tienes permiso" confirmaria que el proyecto existe a quien
    // solo esta probando identificadores.
    expect(respuesta.status).toBe(404);
  });

  it('aceptar una invitacion simultaneamente es idempotente', async () => {
    const projectId = await nuevoProyecto('Invitacion concurrente');
    const invite = await api.request('POST', `/projects/${projectId}/invites`, {
      token: duena.token,
      body: { role: 'VIEWER' },
    });
    const respuestas = await Promise.all(
      Array.from({ length: 4 }, () =>
        api.request('POST', `/invites/${invite.body.code}/accept`, { token: invitado.token }),
      ),
    );
    expect(respuestas.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    expect(respuestas.filter((r) => r.body.alreadyMember === false)).toHaveLength(1);
    expect(respuestas.every((r) => r.body.role === 'VIEWER')).toBe(true);
  });

  it('solo lista los proyectos de los que se es miembro', async () => {
    await nuevoProyecto('Solo de la duena');

    const deExtrano = await api.request('GET', '/projects', { token: extrano.token });

    expect(deExtrano.status).toBe(200);
    expect(deExtrano.body).toEqual([]);
  });

  it('RF-A05 y RF-A06 — invitar por enlace y aceptar', async () => {
    const projectId = await nuevoProyecto('Con invitados');

    const invitacion = await api.request('POST', `/projects/${projectId}/invites`, {
      token: duena.token,
      body: { role: 'EDITOR' },
    });
    expect(invitacion.status).toBe(201);

    const aceptacion = await api.request('POST', `/invites/${invitacion.body.code}/accept`, {
      token: invitado.token,
    });

    expect(aceptacion.status).toBe(200);
    expect(aceptacion.body).toMatchObject({ projectId, role: 'EDITOR', alreadyMember: false });

    const visible = await api.request('GET', `/projects/${projectId}`, { token: invitado.token });
    expect(visible.status).toBe(200);
    expect(visible.body.role).toBe('EDITOR');
  });

  it('aceptar dos veces la misma invitacion no falla', async () => {
    const projectId = await nuevoProyecto('Enlace compartido');
    const invitacion = await api.request('POST', `/projects/${projectId}/invites`, {
      token: duena.token,
      body: { role: 'VIEWER' },
    });

    await api.request('POST', `/invites/${invitacion.body.code}/accept`, { token: invitado.token });
    const segunda = await api.request('POST', `/invites/${invitacion.body.code}/accept`, {
      token: invitado.token,
    });

    // Un enlace compartido se abre mas de una vez; fallar la segunda solo confunde.
    expect(segunda.status).toBe(200);
    expect(segunda.body.alreadyMember).toBe(true);
  });

  it('solo el propietario invita', async () => {
    const projectId = await nuevoProyecto('Quien invita');
    const invitacion = await api.request('POST', `/projects/${projectId}/invites`, {
      token: duena.token,
      body: { role: 'EDITOR' },
    });
    await api.request('POST', `/invites/${invitacion.body.code}/accept`, { token: invitado.token });

    const intento = await api.request('POST', `/projects/${projectId}/invites`, {
      token: invitado.token,
      body: { role: 'EDITOR' },
    });

    expect(intento.status).toBe(403);
  });

  it('RF-A07 — el propietario cambia roles', async () => {
    const projectId = await nuevoProyecto('Cambio de rol');
    const invitacion = await api.request('POST', `/projects/${projectId}/invites`, {
      token: duena.token,
      body: { role: 'EDITOR' },
    });
    await api.request('POST', `/invites/${invitacion.body.code}/accept`, { token: invitado.token });

    const cambio = await api.request('PATCH', `/projects/${projectId}/members/${invitado.userId}`, {
      token: duena.token,
      body: { role: 'VIEWER' },
    });

    expect(cambio.status).toBe(200);
    expect(cambio.body.role).toBe('VIEWER');
  });

  it('no se puede degradar al propietario', async () => {
    const projectId = await nuevoProyecto('Propietario intocable');

    const intento = await api.request('PATCH', `/projects/${projectId}/members/${duena.userId}`, {
      token: duena.token,
      body: { role: 'VIEWER' },
    });

    // Dejaria el proyecto sin nadie que pueda invitar, cambiar roles ni borrarlo.
    expect(intento.status).toBe(409);
    expect(intento.body.error.code).toBe('owner_immutable');
  });

  it('no crea un segundo propietario desde el cambio de rol', async () => {
    const projectId = await nuevoProyecto('Propietario unico');
    const invitacion = await api.request('POST', `/projects/${projectId}/invites`, {
      token: duena.token,
      body: { role: 'EDITOR' },
    });
    await api.request('POST', `/invites/${invitacion.body.code}/accept`, {
      token: invitado.token,
    });

    const intento = await api.request(
      'PATCH',
      `/projects/${projectId}/members/${invitado.userId}`,
      {
        token: duena.token,
        body: { role: 'OWNER' },
      },
    );

    expect(intento.status).toBe(400);
    expect(intento.body.error.code).toBe('validation_failed');
  });

  it('un extrano no descubre al propietario intentando expulsarlo', async () => {
    const projectId = await nuevoProyecto('Propietario privado');

    const intento = await api.request('DELETE', `/projects/${projectId}/members/${duena.userId}`, {
      token: extrano.token,
    });

    expect(intento.status).toBe(404);
  });

  it('rechaza una invitacion inexistente', async () => {
    const respuesta = await api.request('POST', '/invites/codigoinventado/accept', {
      token: invitado.token,
    });

    expect(respuesta.status).toBe(404);
  });

  // -------------------------------------------------------------------------
  // Pizarras
  // -------------------------------------------------------------------------

  it('RF-002 y RF-004 — varias pizarras, cada una con su propia sala', async () => {
    const projectId = await nuevoProyecto('Con dos pizarras');

    const primera = await api.request('POST', `/projects/${projectId}/boards`, {
      token: duena.token,
      body: { displayName: 'Ventas' },
    });
    const segunda = await api.request('POST', `/projects/${projectId}/boards`, {
      token: duena.token,
      body: { displayName: 'Inventario' },
    });

    expect(primera.status).toBe(201);
    expect(segunda.status).toBe(201);

    // CA-004.1 depende de esto: dos pizarras del mismo proyecto no comparten sala.
    expect(primera.body.room).toBe(`project:${projectId}:board:${primera.body.id}`);
    expect(segunda.body.room).not.toBe(primera.body.room);
  });

  it('toda pizarra nace con un snapshot canonico vacio', async () => {
    const projectId = await nuevoProyecto('Snapshot inicial');
    const pizarra = await api.request('POST', `/projects/${projectId}/boards`, {
      token: duena.token,
      body: { displayName: 'Nueva' },
    });

    const leida = await api.request('GET', `/boards/${pizarra.body.id}`, { token: duena.token });

    expect(leida.status).toBe(200);
    expect(leida.body.snapshot).toMatchObject({ version: 1 });
    expect(leida.body.snapshot.canonicalJson).toEqual({ classes: [], relationships: [] });
  });

  it('RF-003 — renombrar y eliminar pizarras', async () => {
    const projectId = await nuevoProyecto('Ciclo de vida');
    const pizarra = await api.request('POST', `/projects/${projectId}/boards`, {
      token: duena.token,
      body: { displayName: 'Provisional' },
    });

    const renombrada = await api.request('PATCH', `/boards/${pizarra.body.id}`, {
      token: duena.token,
      body: { displayName: 'Definitiva' },
    });
    expect(renombrada.body.displayName).toBe('Definitiva');

    const borrada = await api.request('DELETE', `/boards/${pizarra.body.id}`, {
      token: duena.token,
    });
    expect(borrada.status).toBe(204);

    const leida = await api.request('GET', `/boards/${pizarra.body.id}`, { token: duena.token });
    expect(leida.status).toBe(404);
  });

  it('CA-A08.2 — un rol de solo lectura no puede modificar la pizarra', async () => {
    const projectId = await nuevoProyecto('Solo lectura');
    const invitacion = await api.request('POST', `/projects/${projectId}/invites`, {
      token: duena.token,
      body: { role: 'VIEWER' },
    });
    await api.request('POST', `/invites/${invitacion.body.code}/accept`, { token: invitado.token });

    const pizarra = await api.request('POST', `/projects/${projectId}/boards`, {
      token: duena.token,
      body: { displayName: 'Compartida' },
    });

    const puedeVer = await api.request('GET', `/boards/${pizarra.body.id}`, {
      token: invitado.token,
    });
    expect(puedeVer.status).toBe(200);

    const intentaCrear = await api.request('POST', `/projects/${projectId}/boards`, {
      token: invitado.token,
      body: { displayName: 'No deberia existir' },
    });
    expect(intentaCrear.status).toBe(403);

    const intentaRenombrar = await api.request('PATCH', `/boards/${pizarra.body.id}`, {
      token: invitado.token,
      body: { displayName: 'Renombrada por quien no debe' },
    });
    expect(intentaRenombrar.status).toBe(403);
  });

  it('un extrano no ve una pizarra aunque conozca su identificador', async () => {
    const projectId = await nuevoProyecto('Pizarra privada');
    const pizarra = await api.request('POST', `/projects/${projectId}/boards`, {
      token: duena.token,
      body: { displayName: 'Privada' },
    });

    const intento = await api.request('GET', `/boards/${pizarra.body.id}`, {
      token: extrano.token,
    });

    expect(intento.status).toBe(404);
  });

  it('borrar el proyecto arrastra sus pizarras', async () => {
    const projectId = await nuevoProyecto('Efimero');
    const pizarra = await api.request('POST', `/projects/${projectId}/boards`, {
      token: duena.token,
      body: { displayName: 'Se va con el proyecto' },
    });

    expect(
      (await api.request('DELETE', `/projects/${projectId}`, { token: duena.token })).status,
    ).toBe(204);

    const leida = await api.request('GET', `/boards/${pizarra.body.id}`, { token: duena.token });
    expect(leida.status).toBe(404);
  });

  it('solo el propietario borra el proyecto', async () => {
    const projectId = await nuevoProyecto('No lo borres');
    const invitacion = await api.request('POST', `/projects/${projectId}/invites`, {
      token: duena.token,
      body: { role: 'EDITOR' },
    });
    await api.request('POST', `/invites/${invitacion.body.code}/accept`, { token: invitado.token });

    const intento = await api.request('DELETE', `/projects/${projectId}`, {
      token: invitado.token,
    });

    expect(intento.status).toBe(403);
  });
});
