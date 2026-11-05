import {
  emptyBoardState,
  type AiSettingsValues,
  type CommandBatch,
  type SemanticModel,
  type TeamInputMode,
  type ValidationIssue,
} from '@uml/contracts';
import { applyBatch } from './apply.js';
import { validateModel } from './validate.js';

export const semanticIssueKey = (issue: ValidationIssue) =>
  JSON.stringify([issue.code, [...new Set(issue.elementIds)].sort()]);

/** Una misma evaluación pura en API y navegador. WARNING nunca bloquea AUTO_SAFE. */
export function evaluateAiProposal(model: SemanticModel, batch: CommandBatch) {
  const before = new Set(
    validateModel(model)
      .filter((i) => i.severity === 'ERROR')
      .map(semanticIssueKey),
  );
  const outcome = applyBatch({ ...emptyBoardState(), semantic: model }, batch);
  const newErrors = outcome.issues.filter(
    (i) => i.severity === 'ERROR' && !before.has(semanticIssueKey(i)),
  );
  const warnings = outcome.issues.filter((i) => i.severity === 'WARNING');
  const safeCommands =
    batch.commands.length > 0 &&
    batch.commands.every(
      (command) =>
        command.type === 'CREATE_CLASS' ||
        command.type === 'ADD_ATTRIBUTE' ||
        (command.type === 'CREATE_RELATIONSHIP' &&
          (command.payload.kind ?? 'ASSOCIATION') === 'ASSOCIATION'),
    );
  return {
    applicable: outcome.applied,
    safe: outcome.applied && safeCommands && newErrors.length === 0,
    issues: outcome.issues,
    warnings,
    newErrors,
  };
}

export function inputAllowsAutoApply(
  input: TeamInputMode,
  mode: AiSettingsValues['executionMode'],
): boolean {
  return (
    input !== 'DICTATION' &&
    (mode === 'AUTO_SAFE_ALL' || (mode === 'AUTO_SAFE_VOICE' && input === 'VOICE_COMMAND'))
  );
}
