import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from '../support/harness.js';

/**
 * Asistente contra la API real (RF-030 a RF-037).
 *
 * Con el adaptador simulado: estas pruebas corren en integracion continua y
 * nunca llaman a un proveedor de pago (15.5).
 */
describe('asistente', () => {
  let api: Harness;
  let duena: Awaited<ReturnType<Harness['signUp']>>;
  let lector: Awaited<ReturnType<Harness['signUp']>>;
  let extrano: Awaited<ReturnType<Harness['signUp']>>;
  let boardId: string;

  const modelo = {
    classes: [
      {
        id: '44444444-4444-4444-8444-000000000001',
        displayName: 'Cliente',
        codeName: 'Cliente',
        databaseName: 'cliente',
        attributes: [
          {
            id: '44444444-4444-4444-8444-000000000002',
            displayName: 'nombre',
            codeName: 'nombre',
            databaseName: 'nombre',
            type: 'String',
            primaryKey: false,
            nullable: true,
            unique: false,
          },
        ],
      },
    ],
    relationships: [],
  };

  beforeAll(async () => {
    api = await startHarness();
    duena = await api.signUp('duena-ia@example.com');
    lector = await api.signUp('lector-ia@example.com');
    extrano = await api.signUp('extrano-ia@example.com');

    const proyecto = await api.request('POST', '/projects', {
      token: duena.token,
      body: { displayName: 'Proyecto con asistente' },
    });
    const pizarra = await api.request('POST', `/projects/${proyecto.body.id}/boards`, {
      token: duena.token,
      body: { displayName: 'Ventas' },
    });
    boardId = pizarra.body.id as string;

    const invitacion = await api.request('POST', `/projects/${proyecto.body.id}/invites`, {
      token: duena.token,
      body: { role: 'VIEWER' },
    });
    await api.request('POST', `/invites/${invitacion.body.code}/accept`, { token: lector.token });
  }, 180_000);

  afterAll(async () => {
    await api?.stop();
  });

  async function instruir(instruction: string, token = duena.token) {
    return api.request('POST', `/boards/${boardId}/assistant/instruction`, {
      token,
      body: { instruction, model: modelo },
    });
  }

  it('RF-032 — traduce la instruccion a un lote validado', async () => {
    const respuesta = await instruir('agrega telefono tipo String a Cliente');

    expect(respuesta.status).toBe(200);
    expect(respuesta.body.kind).toBe('BATCH');
    expect(respuesta.body.batch.commands).toHaveLength(1);
    expect(respuesta.body.batch.commands[0].type).toBe('ADD_ATTRIBUTE');
    expect(respuesta.body.batch.origin).toBe('AI_TEXT');
  });

  it('RF-A09 — el lote se atribuye a quien lo pidio', async () => {
    const respuesta = await instruir('crea Producto');

    expect(respuesta.body.batch.actorId).toBe(duena.userId);
  });

  it('RF-034 — pregunta en lugar de adivinar', async () => {
    const respuesta = await instruir('agrega telefono tipo String a Inexistente');

    expect(respuesta.body.kind).toBe('QUESTION');
    expect(respuesta.body.options).toContain('Cliente');
  });

  it('el asistente no aplica nada por su cuenta', async () => {
    // Devuelve un lote listo; aplicarlo es cosa del navegador, por el mismo
    // camino que la interfaz grafica. Si el asistente escribiera, habria dos
    // escritores del documento con reglas propias.
    await instruir('crea Proveedor');

    const pizarra = await api.request('GET', `/boards/${boardId}`, { token: duena.token });
    expect(pizarra.body.snapshot.canonicalJson).toEqual({ classes: [], relationships: [] });
  });

  it('RF-036 — un rol de solo lectura puede consultar', async () => {
    const respuesta = await api.request('POST', `/boards/${boardId}/assistant/question`, {
      token: lector.token,
      body: { question: '¿Puedo generar?', model: modelo },
    });

    expect(respuesta.status).toBe(200);
    expect(respuesta.body.answer).toContain('1 clases');
  });

  it('pero no puede instruir', async () => {
    // Devolverle un lote listo a quien no puede aplicarlo solo produce un
    // rechazo mas adelante.
    const respuesta = await instruir('crea Producto', lector.token);

    expect(respuesta.status).toBe(403);
  });

  it('un no miembro no llega al asistente de esa pizarra', async () => {
    const respuesta = await instruir('crea Producto', extrano.token);

    expect(respuesta.status).toBe(404);
  });

  it('exige sesion', async () => {
    const respuesta = await api.request('POST', `/boards/${boardId}/assistant/instruction`, {
      body: { instruction: 'crea Producto', model: modelo },
    });

    expect(respuesta.status).toBe(401);
  });

  it('rechaza un modelo que no cumple el contrato', async () => {
    const respuesta = await api.request('POST', `/boards/${boardId}/assistant/instruction`, {
      token: duena.token,
      body: { instruction: 'crea Producto', model: { classes: 'no es una lista' } },
    });

    expect(respuesta.status).toBe(400);
    expect(respuesta.body.error.code).toBe('validation_failed');
  });

  it('valida el contexto conversacional y limita su tamano', async () => {
    const demasiados = Array.from({ length: 11 }, (_, indice) => ({
      role: indice % 2 === 0 ? 'user' : 'assistant',
      text: `turno ${indice}`,
    }));
    const respuesta = await api.request('POST', `/boards/${boardId}/assistant/instruction`, {
      token: duena.token,
      body: { instruction: 'crea Producto', context: demasiados, model: modelo },
    });

    expect(respuesta.status).toBe(400);
    expect(respuesta.body.error.code).toBe('validation_failed');
  });

  it('registra el uso del proveedor (6.5)', async () => {
    const respuesta = await api.request('GET', '/assistant/usage', { token: duena.token });

    expect(respuesta.status).toBe(200);
    expect(respuesta.body.provider).toBe('mock');
    expect(respuesta.body.calls).toBeGreaterThan(0);
  });

  it('transcribe audio mayor de un MiB sin ampliar el límite de otras rutas', async () => {
    const response = await api.request('POST', '/assistant/transcribe', {
      token: duena.token,
      body: { audio: 'A'.repeat(1_100_000), mediaType: 'audio/webm' },
    });
    expect(response.status).toBe(200);
    expect(typeof response.body.text).toBe('string');
    const other = await api.request('POST', '/auth/login', {
      body: { password: 'A'.repeat(1_100_000), email: 'test@example.com' },
    });
    expect(other.status).toBe(413);
  });

  it('acepta el máximo de audio del contrato y rechaza superar el contrato o el cuerpo HTTP', async () => {
    for (const [size, status] of [
      [8_000_000, 200],
      [8_000_001, 400],
      [8_002_000, 413],
    ] as const) {
      const response = await api.request('POST', '/assistant/transcribe', {
        token: duena.token,
        body: { audio: 'A'.repeat(size), mediaType: 'audio/webm' },
      });
      expect(response.status).toBe(status);
    }
  });
});
