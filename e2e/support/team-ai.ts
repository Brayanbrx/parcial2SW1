import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { MockLlmPort, resolveProposal, type ProposeOptions } from '@uml/ai';
import { validateModel } from '@uml/domain-core';
import {
  AI_PROPOSAL_TTL_MS,
  aiProposalSchema,
  clarificationText,
  teamMessageSchema,
  teamRequestBodySchema,
  teamRequestKind,
  type AiProposal,
  type TeamMessage,
  type TeamRequestBody,
} from '@uml/contracts';
import { clarificationTurns } from '../../frontend/src/features/team-assistant/feed-model.js';

export type MockOutcome = ReturnType<typeof resolveProposal> | { answer: string };
export type MockTurn = TeamRequestBody & {
  authorId: string;
  instruction: string;
  context: NonNullable<ProposeOptions['context']>;
};

/** Simula únicamente el worker pendiente del paso 6 y su API asíncrona.
 * DTO reales, identidad de la sesión, 202, consultas posteriores y cancelación.
 * Compartir una instancia permite ejercitar varias identidades sobre el mismo feed. */
export function createTeamAiMock(handler?: (turn: MockTurn) => MockOutcome | Promise<MockOutcome>) {
  const messages = new Map<string, TeamMessage>();
  const proposals = new Map<string, AiProposal>();
  const requests: MockTurn[] = [];
  const tasks = new Set<Promise<void>>();
  const model = new MockLlmPort();
  let time = Date.now();
  const stamp = () => new Date(++time).toISOString();
  async function complete(message: TeamMessage, turn: MockTurn) {
    const outcome = handler
      ? await handler(turn)
      : turn.mode === 'INSTRUCT'
        ? resolveProposal({
            proposal: (
              await model.proposeCommands({
                instruction: turn.text,
                snapshot: turn.model,
                context: turn.context,
              })
            ).proposal,
            model: turn.model,
            actorId: turn.authorId,
            origin: 'AI_TEXT',
          })
        : {
            answer: (
              await model.answer({
                question: turn.text,
                snapshot: turn.model,
                issues: validateModel(turn.model),
              })
            ).text,
          };
    if (messages.get(message.id)?.status === 'CANCELLED') return;
    messages.set(
      message.id,
      teamMessageSchema.parse({ ...message, status: 'DONE', updatedAt: stamp() }),
    );
    const now = stamp();
    const text =
      'answer' in outcome
        ? outcome.answer
        : outcome.kind === 'QUESTION'
          ? clarificationText(outcome.question, outcome.options)
          : outcome.kind === 'REJECTED'
            ? outcome.issues.map((issue) => issue.message).join(' ')
            : outcome.summary.join('\n');
    const response = teamMessageSchema.parse({
      id: randomUUID(),
      boardId: message.boardId,
      authorKind: 'AI',
      authorId: null,
      addressedToId: message.authorId,
      replyToId: message.id,
      clientRequestId: null,
      mode: null,
      inputMode: null,
      status: null,
      errorCode: null,
      text,
      kind:
        'answer' in outcome
          ? turn.mode === 'REVIEW'
            ? 'REVIEW'
            : 'ANSWER'
          : outcome.kind === 'QUESTION'
            ? 'CLARIFICATION'
            : outcome.kind === 'REJECTED'
              ? 'ANSWER'
              : 'PROPOSAL',
      createdAt: now,
      updatedAt: now,
    });
    messages.set(response.id, response);
    if (!('answer' in outcome) && (outcome.kind === 'BATCH' || outcome.kind === 'CONFIRMATION')) {
      const proposal = aiProposalSchema.parse({
        id: randomUUID(),
        boardId: message.boardId,
        requestMessageId: message.id,
        requesterId: message.authorId,
        batchId: outcome.batch.batchId,
        batch: outcome.batch,
        expectedSemantic: turn.model,
        status: outcome.kind === 'CONFIRMATION' ? 'PENDING_CONFIRMATION' : 'READY',
        rejectReason: null,
        createdAt: now,
        updatedAt: now,
        expiresAt: new Date(Date.parse(now) + AI_PROPOSAL_TTL_MS).toISOString(),
        decidedAt: null,
        decidedById: null,
      });
      proposals.set(proposal.id, proposal);
    }
  }
  return {
    requests,
    messages,
    proposals,
    async settled() {
      await Promise.all(tasks);
    },
    async install(page: Page) {
      await page.route(/\/api\/boards\/[^/]+\/team-ai\//, async (route) => {
        const req = route.request(),
          url = new URL(req.url());
        const [, boardId, resource, id, action] =
          /\/boards\/([^/]+)\/team-ai\/(messages|proposals)(?:\/([^/]+))?(?:\/([^/]+))?/.exec(
            url.pathname,
          )!;
        const token = req.headers()['authorization']?.split(' ')[1];
        const authorId = token
          ? (
              JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()) as {
                sub: string;
              }
            ).sub
          : '';
        const reply = (json: unknown, status = 200) => route.fulfill({ status, json });
        if (req.method() === 'POST' && resource === 'messages' && !id) {
          const body = teamRequestBodySchema.parse(req.postDataJSON());
          const existing = [...messages.values()].find(
            (m) => m.clientRequestId === body.clientRequestId,
          );
          if (existing) {
            await reply(existing, 202);
            return;
          }
          const now = stamp();
          const { model: _model, ...messageBody } = body;
          const message = teamMessageSchema.parse({
            ...messageBody,
            id: randomUUID(),
            boardId,
            authorKind: 'USER',
            authorId,
            addressedToId: null,
            kind: teamRequestKind[body.mode],
            status: 'QUEUED',
            errorCode: null,
            createdAt: now,
            updatedAt: now,
          });
          messages.set(message.id, message);
          const turn: MockTurn = {
            ...body,
            authorId,
            instruction: body.text,
            context: clarificationTurns([...messages.values()], body.replyToId, authorId),
          };
          requests.push(turn);
          await reply(message, 202);
          const task = complete(message, turn);
          tasks.add(task);
          void task.finally(() => tasks.delete(task));
          return;
        }
        if (req.method() === 'GET' && !id) {
          const cursor = url.searchParams.get('changedSince');
          const since = cursor && Number.isFinite(Number(cursor)) ? Number(cursor) : 0;
          await reply({
            messages: [...messages.values()].filter(
              (m) => m.boardId === boardId && Date.parse(m.updatedAt) > since,
            ),
            proposals: [...proposals.values()].filter(
              (p) => p.boardId === boardId && Date.parse(p.updatedAt) > since,
            ),
            nextCursor: String(time),
            hasMore: false,
          });
          return;
        }
        if (req.method() === 'GET' && id) {
          await reply({
            message: messages.get(id),
            proposal: [...proposals.values()].find((p) => p.requestMessageId === id) ?? null,
          });
          return;
        }
        if (resource === 'messages' && id && action === 'cancel') {
          const message = messages.get(id)!;
          if (message.authorId !== authorId) {
            await reply({ error: { message: 'Sin permiso' } }, 403);
            return;
          }
          const updated = teamMessageSchema.parse({
            ...message,
            status: 'CANCELLED',
            updatedAt: stamp(),
          });
          messages.set(id, updated);
          await reply(updated);
          return;
        }
        if (resource === 'proposals' && id) {
          const proposal = proposals.get(id)!;
          if (proposal.requesterId !== authorId) {
            await reply({ error: { message: 'Sin permiso' } }, 403);
            return;
          }
          const reason =
            action === 'reject' ? (req.postDataJSON() as { reason: string }).reason : null;
          const updated = aiProposalSchema.parse({
            ...proposal,
            status: action === 'confirm' ? 'READY' : reason === 'STALE' ? 'STALE' : 'REJECTED',
            rejectReason: reason,
            updatedAt: stamp(),
            decidedAt: stamp(),
            decidedById: authorId,
          });
          proposals.set(id, updated);
          await reply(updated);
          return;
        }
        await route.fallback();
      });
      await page.route(/\/api\/boards\/[^/]+\/audit$/, async (route) => {
        const req = route.request();
        if (req.method() !== 'POST') {
          await route.fallback();
          return;
        }
        const body = req.postDataJSON() as { batchId: string };
        const proposal = [...proposals.values()].find((p) => p.batchId === body.batchId);
        if (!proposal) {
          await route.fallback();
          return;
        }
        const response = await route.fetch(); // El lote real sigue llegando a la auditoría existente.
        if (response.ok())
          proposals.set(
            proposal.id,
            aiProposalSchema.parse({ ...proposal, status: 'APPLIED', updatedAt: stamp() }),
          );
        await route.fulfill({ response });
      });
    },
  };
}
