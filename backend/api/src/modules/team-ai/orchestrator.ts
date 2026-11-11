import {
  ProviderContractError,
  resolveProposal,
  createTaskRouter,
  buildTeamContext,
  TeamContextError,
  type AiPorts,
  type LlmPort,
  type TeachingPolicy,
} from '@uml/ai';
import {
  semanticModelSchema,
  clarificationText,
  type CommandBatch,
  type SemanticModel,
  type AiExecutionTarget,
  aiExecutionTargetSchema,
} from '@uml/contracts';
import { evaluateAiProposal, validateModel } from '@uml/domain-core';
import type { TeamMessage, PrismaClient } from '@prisma/client';
import { loadTeamHistory, type ContextLimits } from './context-repository.js';

export interface TeamWorkResult {
  /** Se revalida bajo el bloqueo del proyecto antes de publicar. */
  solutionMode?: TeachingPolicy['solutionMode'];
  kind: 'ANSWER' | 'REVIEW' | 'CLARIFICATION' | 'PROPOSAL';
  text: string;
  proposal?: {
    batch: CommandBatch;
    expectedSemantic: SemanticModel;
    status: 'READY' | 'PENDING_CONFIRMATION';
  };
}
export type TeamProcessor = (job: TeamMessage, signal: AbortSignal) => Promise<TeamWorkResult>;

/** La API carga historial; shared/ai arma el contexto puro y los prompts. */
export function createTeamProcessor(
  ports: AiPorts,
  options?: {
    prisma: PrismaClient;
    limits: ContextLimits;
    maxInputTokens: number;
    executionPort?(
      target: Extract<AiExecutionTarget, { source: 'VM' | 'DEVICE' }>,
      userId: string,
    ): Promise<LlmPort>;
  },
): TeamProcessor {
  return async (job, signal) => {
    const model = semanticModelSchema.parse(job.requestModel);
    const board = options
      ? await options.prisma.board.findUniqueOrThrow({
          where: { id: job.boardId },
          select: { projectId: true },
        })
      : undefined;
    const settings =
      board && options
        ? await options.prisma.projectAiSettings.findUnique({
            where: { projectId: board.projectId },
          })
        : undefined;
    if (settings?.enabled === false) throw new Error('ai_disabled');
    if (job.mode === 'REVIEW' && settings?.reviewMode === 'OFF')
      throw new Error('team_ai_review_disabled');
    const target = job.executionTarget
      ? aiExecutionTargetSchema.parse(job.executionTarget)
      : undefined;
    const source = target?.source ?? settings?.aiSource ?? 'PROVIDERS';
    const external = target?.source === 'VM' || target?.source === 'DEVICE' ? target : undefined;
    if (source === 'VM' && !external) throw new Error('ai_engine_unavailable');
    if (external && !options?.executionPort) throw new Error('ai_engine_unavailable');
    const { portFor } = createTaskRouter(ports, source === 'LOCAL' ? 'LOCAL' : 'PROVIDERS');
    const teaching: TeachingPolicy | undefined =
      job.mode === 'INSTRUCT'
        ? undefined
        : {
            solutionMode: settings?.solutionMode ?? 'ON_REQUEST',
            task: job.mode === 'REVIEW' ? 'REVIEW' : 'ASK',
          };
    // Las sugerencias resueltas no se envían al proveedor en Solo pistas.
    const issues = validateModel(model).map(({ suggestion, ...issue }) =>
      teaching?.solutionMode === 'HINTS_ONLY' || suggestion === undefined
        ? issue
        : { ...issue, suggestion },
    );
    const text = job.mode === 'REVIEW' ? `Revisa este diagrama UML. ${job.text}` : job.text;
    if (!options && job.replyToId) throw new Error('team_ai_invalid_context');
    const loaded = options ? await loadTeamHistory(options.prisma, job, options.limits) : undefined;
    signal.throwIfAborted();
    let port = external
      ? await options!.executionPort!(external, job.authorId!)
      : portFor(job.mode === 'INSTRUCT' ? 'instruct' : job.mode === 'REVIEW' ? 'review' : 'mentor');
    const context = loaded?.context ?? [];
    const contextFor = (selected: LlmPort) =>
      loaded && options
        ? buildTeamContext(
            {
              ...loaded.history,
              request: {
                mode: job.mode!,
                text,
                snapshot: model,
                issues,
                context,
                ...(teaching ? { teaching } : {}),
              },
            },
            {
              maxInputTokens: Math.min(
                options.maxInputTokens,
                selected.capabilities?.contextWindow ?? options.maxInputTokens,
              ),
            },
          )
        : undefined;
    let team: ReturnType<typeof contextFor>;
    try {
      team = contextFor(port);
    } catch (error) {
      // El modelo local tiene una ventana menor que la nube: si la solicitud no
      // cabe en ella, responde la cadena de proveedores en lugar de fallar.
      const tooLarge = error instanceof TeamContextError && error.code === 'team_ai_input_budget';
      if (!tooLarge || external || port === ports.llm) throw error;
      port = ports.llm;
      team = contextFor(port);
    }
    if (job.mode !== 'INSTRUCT') {
      const result = await port.answer({
        question: text,
        snapshot: model,
        issues,
        signal,
        ...(teaching ? { teaching } : {}),
        ...(team ? { team } : {}),
      });
      if (!result.text.trim()) throw new ProviderContractError(port.name, 'empty_answer');
      return {
        kind: job.mode === 'REVIEW' ? 'REVIEW' : 'ANSWER',
        text: result.text,
        solutionMode: teaching!.solutionMode,
      };
    }
    const { proposal } = await port.proposeCommands({
      instruction: job.text,
      snapshot: model,
      signal,
      context,
      ...(team ? { team } : {}),
    });
    const outcome = resolveProposal({
      proposal,
      model,
      actorId: job.authorId!,
      origin: job.inputMode === 'VOICE_COMMAND' ? 'AI_VOICE' : 'AI_TEXT',
    });
    if (outcome.kind === 'QUESTION')
      return { kind: 'CLARIFICATION', text: clarificationText(outcome.question, outcome.options) };
    if (outcome.kind === 'REJECTED') throw new Error('team_ai_invalid_proposal');
    const policy = evaluateAiProposal(model, outcome.batch);
    if (!policy.applicable) throw new Error('team_ai_invalid_proposal');
    return {
      kind: 'PROPOSAL',
      text: [
        outcome.summary.join('\n'),
        ...policy.warnings.map((issue) => `Aviso: ${issue.message}`),
        ...policy.newErrors.map((issue) => `Error nuevo: ${issue.message}`),
        !policy.safe || outcome.kind === 'CONFIRMATION'
          ? '¿Confirmas? Este lote necesita revisión antes de aplicarse.'
          : '',
      ]
        .filter(Boolean)
        .join('\n'),
      proposal: {
        batch: outcome.batch,
        expectedSemantic: model,
        status: policy.safe && outcome.kind === 'BATCH' ? 'READY' : 'PENDING_CONFIRMATION',
      },
    };
  };
}
