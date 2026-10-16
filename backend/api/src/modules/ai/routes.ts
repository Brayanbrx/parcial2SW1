import { semanticModelSchema } from '@uml/contracts';
import { validateModel } from '@uml/domain-core';
import {
  ProviderContractError,
  ProviderUnavailableError,
  createAiPorts,
  loadAiConfig,
  resolveProposal,
  type AiPorts,
} from '@uml/ai';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError } from '../../lib/http-error.js';
import { withRequestCancellation } from '../../lib/request-cancellation.js';
import { currentUser } from '../../plugins/auth.js';
import { requireMembership, requireWriteAccess } from '../projects/membership.js';

/**
 * Asistente por texto y voz
 * Recibe una instruccion y el estado de la pizarra, se lo pasa al proveedor a traves del puerto,
 * resuelve la propuesta contra el modelo real y devuelve un lote listo o una pregunta.
 */

const boardParams = z.object({ boardId: z.string().uuid() });

const instructionBody = z.object({
  instruction: z.string().trim().min(1).max(2000),
  context: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        text: z.string().trim().min(1).max(2000),
      }),
    )
    .max(10)
    .default([]),
  model: semanticModelSchema,
});

const questionBody = z.object({
  question: z.string().trim().min(1).max(2000),
  model: semanticModelSchema,
});

const transcribeBody = z.object({
  /** Audio en base64. Respaldo del reconocimiento del navegador*/
  audio: z.string().min(1).max(8_000_000),
  mediaType: z.string().min(1).max(100),
});

// Base64 más el envoltorio JSON. Igual que imagen, no amplía otras rutas.
const TRANSCRIBE_BODY_LIMIT = 8_000_000 + 1024;

export async function aiRoutes(
  app: FastifyInstance,
  options: { ports?: AiPorts } = {},
): Promise<void> {
  const ports = options.ports ?? createAiPorts(loadAiConfig());

  app.addHook('preHandler', app.authenticate);

   // Instruccion por texto (o dictada) a lote validado
  app.post('/boards/:boardId/assistant/instruction', async (request, reply) => {
    const { boardId } = boardParams.parse(request.params);
    const body = instructionBody.parse(request.body);
    const { userId } = currentUser(request);

    const board = await findBoard(app, boardId);
    await requireWriteAccess(app.prisma, board.projectId, userId);

    const { proposal, usage } = await withRequestCancellation(request, reply, (signal) =>
      conProveedor(() =>
        ports.llm.proposeCommands({
          instruction: body.instruction,
          snapshot: body.model,
          context: body.context,
          signal,
        }),
      ),
    );

    const outcome = resolveProposal({
      proposal,
      model: body.model,
      actorId: userId,
      origin: 'AI_TEXT',
    });

    // El registro estructurado deja el proveedor, la latencia y el
    // desenlace, que es lo que se mira cuando el asistente hace algo raro.
    request.log.info(
      {
        boardId,
        origin: 'AI_TEXT',
        provider: usage?.provider,
        latencyMs: usage?.latencyMs,
        outcome: outcome.kind,
        operations: proposal.operations.length,
        contextTurns: body.context.length,
      },
      'instruccion del asistente',
    );

    return { ...outcome, rationale: proposal.rationale ?? null };
  });

  /** Consultar sin modificar. */
  app.post('/boards/:boardId/assistant/question', async (request, reply) => {
    const { boardId } = boardParams.parse(request.params);
    const body = questionBody.parse(request.body);
    const { userId } = currentUser(request);

    const board = await findBoard(app, boardId);
    // Solo lectura: un VIEWER puede consultar al asistente sin modificar.
    await requireMembership(app.prisma, board.projectId, userId);

    const issues = validateModel(body.model).map((hallazgo) => ({
      code: hallazgo.code,
      severity: hallazgo.severity,
      message: hallazgo.message,
    }));

    const { text, usage } = await withRequestCancellation(request, reply, (signal) =>
      conProveedor(() =>
        ports.llm.answer({ question: body.question, snapshot: body.model, issues, signal }),
      ),
    );

    request.log.info(
      { boardId, provider: usage?.provider, latencyMs: usage?.latencyMs },
      'consulta al asistente',
    );

    return { answer: text, issues };
  });

  /** Respaldo de transcripcion, para navegadores sin reconocimiento */
  app.post(
    '/assistant/transcribe',
    { bodyLimit: TRANSCRIBE_BODY_LIMIT },
    async (request, reply) => {
      const body = transcribeBody.parse(request.body);

      const { text } = await withRequestCancellation(request, reply, (signal) =>
        conProveedor(() =>
          ports.speech.transcribe({
            audio: Buffer.from(body.audio, 'base64'),
            mediaType: body.mediaType,
            signal,
          }),
        ),
      );

      return { text };
    },
  );

  /** Uso acumulado del proceso, para diagnosticar y para la defensa */
  app.get('/assistant/usage', async () => ({
    provider: ports.llm.name,
    calls: ports.usageLog.length,
    recent: ports.usageLog.slice(-20),
  }));
}

/**
 * Traduce los fallos del proveedor a respuestas HTTP con sentido.
 * Un proveedor caido no es un fallo del servidor: es dependencia externa que
 * no respondio y el usuario tiene que poder distinguirlo para saber si merece
 * la pena reintentar.
 */
async function conProveedor<T>(llamar: () => Promise<T>): Promise<T> {
  try {
    return await llamar();
  } catch (error) {
    if (error instanceof ProviderUnavailableError) {
      throw new HttpError(
        503,
        'ai_provider_unavailable',
        `El asistente no esta disponible ahora mismo (${error.provider}). Vuelve a intentarlo.`,
      );
    }
    if (error instanceof ProviderContractError) {

      throw new HttpError(502, 'ai_provider_contract', `${error.provider}: ${error.message}`);
    }
    throw error;
  }
}

async function findBoard(
  app: FastifyInstance,
  boardId: string,
): Promise<{ id: string; projectId: string }> {
  const board = await app.prisma.board.findUnique({
    where: { id: boardId },
    select: { id: true, projectId: true },
  });

  if (board === null) throw new HttpError(404, 'not_found', 'La pizarra no existe.');
  return board;
}
