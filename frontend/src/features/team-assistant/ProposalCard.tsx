import { useEffect, useRef, useState } from 'react';
import {
  proposalStatusAt,
  type AiProposal,
  type AiRejectReason,
  type CommandBatch,
  type SemanticModel,
  type ValidationIssue,
  type ProjectAiSettings,
  type TeamMessage,
} from '@uml/contracts';
import { evaluateAiProposal, inputAllowsAutoApply } from '@uml/domain-core';
import { hasPendingBatchAudit, teamAiApi } from '../../lib/api.js';
import type { ProposalExecution } from './proposal-execution.js';
import { proposalLabel, summarizeCommand } from './feed-model.js';

export function ProposalCard({
  proposal,
  projectId,
  request,
  settings,
  execution,
  userId,
  canWrite,
  online,
  apply,
  refresh,
  restore,
}: {
  proposal: AiProposal;
  projectId: string;
  request: TeamMessage;
  settings: ProjectAiSettings | null;
  execution: ProposalExecution;
  userId: string;
  canWrite: boolean;
  online: boolean;
  apply(
    batch: CommandBatch,
    expected: SemanticModel,
    scope: 'AFFECTED',
  ): readonly ValidationIssue[] | null;
  refresh(): Promise<void>;
  restore(): void;
}) {
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const mounted = useRef(true);
  const access = useRef({ canWrite, online, settings });
  access.current = { canWrite, online, settings };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [local, setLocal] = useState<'APPLIED' | 'STALE' | 'REJECTED' | null>(() =>
    execution.wasApplied(proposal.batchId) ||
    hasPendingBatchAudit(userId, proposal.boardId, proposal.batchId)
      ? 'APPLIED'
      : null,
  );
  const [unsent, setUnsent] = useState<AiRejectReason | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mine = proposal.requesterId === userId;
  const status = local ?? proposalStatusAt(proposal, Date.now());
  async function report(reason: AiRejectReason) {
    try {
      await teamAiApi.reject(proposal.boardId, proposal.id, reason);
      setUnsent(null);
    } catch (cause) {
      setUnsent(reason);
      throw cause;
    }
  }
  async function decide(action: 'apply' | 'auto' | 'reject' | 'retry') {
    if (
      lock.current ||
      !mine ||
      !online ||
      ((action === 'apply' || action === 'auto') && !canWrite)
    )
      return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      if (action === 'retry' && unsent) await report(unsent);
      else if (action === 'reject') {
        await report('USER');
        setLocal('REJECTED');
      } else if ((action === 'apply' || action === 'auto') && !local) {
        if (
          execution.wasApplied(proposal.batchId) ||
          hasPendingBatchAudit(userId, proposal.boardId, proposal.batchId)
        ) {
          setLocal('APPLIED');
          return;
        }
        let fresh =
          action === 'apply' && proposal.status === 'PENDING_CONFIRMATION'
            ? await teamAiApi.confirm(proposal.boardId, proposal.id)
            : (await teamAiApi.message(proposal.boardId, proposal.requestMessageId)).proposal;
        if (!mounted.current || !access.current.canWrite || !access.current.online) return;
        if (
          !fresh ||
          fresh.id !== proposal.id ||
          fresh.boardId !== proposal.boardId ||
          fresh.requesterId !== userId ||
          proposalStatusAt(fresh, Date.now()) !== 'READY'
        )
          throw new Error('La propuesta ya no está lista. Se actualizará su estado.');
        if (action === 'auto') {
          const currentSettings = await teamAiApi.settings(projectId, AbortSignal.timeout(15000));
          if (
            request.authorKind !== 'USER' ||
            fresh.decidedAt !== null ||
            !currentSettings.enabled ||
            !inputAllowsAutoApply(request.inputMode, currentSettings.executionMode) ||
            !evaluateAiProposal(fresh.expectedSemantic, fresh.batch).safe
          )
            return;
          // READY es idempotente: comprobar escritura vigente sin confirmar un lote sensible.
          fresh = await teamAiApi.confirm(proposal.boardId, proposal.id);
          if (proposalStatusAt(fresh, Date.now()) !== 'READY' || fresh.decidedAt !== null) return;
        }
        if (!mounted.current || !access.current.canWrite || !access.current.online) return;
        if (
          action === 'auto' &&
          (!access.current.settings?.enabled ||
            request.authorKind !== 'USER' ||
            !inputAllowsAutoApply(request.inputMode, access.current.settings.executionMode))
        )
          return;
        let issues: readonly ValidationIssue[] | null;
        try {
          issues = apply(fresh.batch, fresh.expectedSemantic, 'AFFECTED');
        } catch {
          issues = [
            {
              code: 'WRITE_ACCESS_DENIED',
              severity: 'ERROR',
              elementIds: [],
              message: 'No se pudo aplicar el cambio localmente.',
            },
          ];
        }
        if (issues === null) {
          execution.markApplied(fresh.batchId);
          setLocal('APPLIED');
        } else {
          const stale = issues.some((issue) => issue.code === 'STALE_PROPOSAL');
          const reason = stale ? 'STALE' : 'APPLY_FAILED';
          setLocal(stale ? 'STALE' : 'REJECTED');
          if (stale) restore();
          setError(issues.map((issue) => issue.message).join(' '));
          await report(reason);
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo completar la acción.');
    } finally {
      lock.current = false;
      setBusy(false);
      try {
        await refresh();
      } catch {
        /* El feed conserva su propio aviso y reconciliación. */
      }
    }
  }
  useEffect(() => {
    if (
      mine &&
      canWrite &&
      online &&
      !local &&
      settings &&
      !lock.current &&
      execution.takeAuto(proposal, request, settings)
    )
      void decide('auto');
  });
  const active = status === 'READY' || status === 'PENDING_CONFIRMATION';
  return (
    <div className="propuesta" data-testid="propuesta" data-proposal-id={proposal.id}>
      <ul className="resumen">
        {proposal.batch.commands.map((command) => (
          <li key={command.commandId}>{summarizeCommand(command, proposal)}</li>
        ))}
      </ul>
      {mine && status === 'PENDING_CONFIRMATION' && (
        <p className="advertencia" data-testid="confirmacion">
          ¿Confirmas? Revisa los cambios antes de aplicarlos.
        </p>
      )}
      {mine && status === 'STALE' ? (
        <p className="advertencia" data-testid="propuesta-obsoleta">
          Propuesta desactualizada. Revisa la instrucción antes de enviarla de nuevo.
        </p>
      ) : (
        <p className={status === 'APPLIED' ? 'aplicada' : 'team-status'}>{proposalLabel[status]}</p>
      )}
      {local === 'APPLIED' && proposal.status !== 'APPLIED' && (
        <small>Aplicado localmente; esperando auditoría.</small>
      )}
      {proposal.rejectReason === 'APPLY_FAILED' && (
        <small>La aplicación local falló. Para reintentar, envía una nueva solicitud.</small>
      )}
      {mine && active && (
        <div className="team-actions">
          <button
            type="button"
            className="principal"
            data-testid="aplicar-propuesta"
            disabled={!canWrite || !online || busy}
            onClick={() => void decide('apply')}
          >
            {status === 'PENDING_CONFIRMATION' ? 'Sí, aplicar' : 'Aplicar'}
          </button>
          <button type="button" disabled={!online || busy} onClick={() => void decide('reject')}>
            Rechazar
          </button>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {mine && unsent && (
        <button type="button" disabled={!online || busy} onClick={() => void decide('retry')}>
          Sincronizar rechazo
        </button>
      )}
    </div>
  );
}
