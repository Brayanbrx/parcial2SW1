import type { CommandBatch } from '@uml/contracts';

/** Quitar una clase del archivo quita también los atributos, geometría y
 * enlaces que dependen de ella. Las eliminaciones del modo reemplazo quedan
 * explícitas para que la persona pueda conservar o retirar cada una. */
export function removeCandidateCommand(batch: CommandBatch, commandId: string): CommandBatch {
  const removed = batch.commands.find((c) => c.commandId === commandId);
  const classId = removed?.type === 'CREATE_CLASS' ? removed.payload.classId : null;
  return {
    ...batch,
    commands: batch.commands.filter((c) => {
      if (c.commandId === commandId) return false;
      if (classId === null || c.type === 'DELETE_CLASS') return true;
      const p = c.payload;
      return (
        !('classId' in p && p.classId === classId) &&
        !('sourceClassId' in p && p.sourceClassId === classId) &&
        !('targetClassId' in p && p.targetClassId === classId)
      );
    }),
  };
}
