import { UML_PRIMITIVE_TYPES, type Command, type CommandBatch } from '@uml/contracts';

export function editCandidateCommand(
  batch: CommandBatch,
  id: string,
  edit: (command: Command) => Command,
): CommandBatch {
  const original = batch.commands.find((command) => command.commandId === id);
  if (!original) return batch;
  const updated = edit(original);
  const from = original.type === 'CREATE_CLASS' ? original.payload.displayName : null;
  const to = updated.type === 'CREATE_CLASS' ? updated.payload.displayName : null;
  const rename =
    from !== null &&
    to !== null &&
    from !== to &&
    from !== 'void' &&
    !UML_PRIMITIVE_TYPES.includes(from) &&
    !batch.commands.some(
      (command) =>
        command.commandId !== id &&
        command.type === 'CREATE_CLASS' &&
        command.payload.displayName === from,
    );
  const typeOf = (type: string) => (rename && type === from && to.trim() ? to : type);
  return {
    ...batch,
    commands: batch.commands.map((command) => {
      if (command.commandId === id) return updated;
      if (!rename) return command;
      if (command.type === 'ADD_ATTRIBUTE')
        return { ...command, payload: { ...command.payload, type: typeOf(command.payload.type) } };
      if (command.type !== 'ADD_OPERATION') return command;
      const operation = command.payload.operation;
      return {
        ...command,
        payload: {
          ...command.payload,
          operation: {
            ...operation,
            ...(operation.returnType === undefined
              ? {}
              : { returnType: typeOf(operation.returnType) }),
            parameters: operation.parameters.map((p) => ({ ...p, type: typeOf(p.type) })),
          },
        },
      };
    }),
  };
}

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
