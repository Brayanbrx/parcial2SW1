import {
  CONCEPTUAL_TYPES,
  MULTIPLICITIES,
  RELATIONSHIP_KINDS,
  type BoardState,
  type Command,
  type CommandBatch,
} from '@uml/contracts';

export function CandidateEditor({
  batch,
  state,
  onChange,
  onRemove,
}: {
  readonly batch: CommandBatch;
  readonly state: BoardState;
  onChange(commandId: string, editar: (command: Command) => Command): void;
  onRemove(commandId: string): void;
}): React.JSX.Element {
  const nombres = new Map(
    state.semantic.classes.map((umlClass) => [umlClass.id, umlClass.displayName]),
  );
  for (const command of batch.commands) {
    if (command.type === 'CREATE_CLASS')
      nombres.set(command.payload.classId, command.payload.displayName);
  }

  return (
    <div className="editor-candidato" data-testid="editor-candidato">
      {batch.commands.map((command, indice) => {
        const numero = indice + 1;
        const render = (): React.JSX.Element => {
          if (command.type === 'CREATE_CLASS' || command.type === 'RENAME_CLASS') {
            return (
              <label className="fila-candidato" key={command.commandId}>
                <span>
                  {command.type === 'CREATE_CLASS' ? `Clase ${numero}` : `Renombrar ${numero}`}
                </span>
                <input
                  value={command.payload.displayName}
                  aria-label={`Nombre de clase ${numero}`}
                  onChange={(evento) =>
                    onChange(command.commandId, (actual) => {
                      if (actual.type !== command.type) return actual;
                      return {
                        ...actual,
                        payload: { ...actual.payload, displayName: evento.target.value },
                      };
                    })
                  }
                />
              </label>
            );
          }

          if (command.type === 'ADD_ATTRIBUTE') {
            return (
              <div className="fila-candidato atributo-candidato" key={command.commandId}>
                <span>{nombres.get(command.payload.classId) ?? 'Clase'} · atributo</span>
                <input
                  value={command.payload.displayName}
                  aria-label={`Nombre de atributo ${numero}`}
                  onChange={(evento) =>
                    onChange(command.commandId, (actual) =>
                      actual.type === 'ADD_ATTRIBUTE'
                        ? {
                            ...actual,
                            payload: { ...actual.payload, displayName: evento.target.value },
                          }
                        : actual,
                    )
                  }
                />
                <select
                  value={command.payload.type}
                  aria-label={`Tipo de atributo ${numero}`}
                  onChange={(evento) =>
                    onChange(command.commandId, (actual) =>
                      actual.type === 'ADD_ATTRIBUTE'
                        ? {
                            ...actual,
                            payload: {
                              ...actual.payload,
                              type: evento.target.value as (typeof CONCEPTUAL_TYPES)[number],
                            },
                          }
                        : actual,
                    )
                  }
                >
                  {CONCEPTUAL_TYPES.map((tipo) => (
                    <option key={tipo}>{tipo}</option>
                  ))}
                </select>
                <label className="marca-candidato">
                  <input
                    type="checkbox"
                    checked={command.payload.primaryKey ?? false}
                    onChange={(evento) =>
                      onChange(command.commandId, (actual) =>
                        actual.type === 'ADD_ATTRIBUTE'
                          ? {
                              ...actual,
                              payload: { ...actual.payload, primaryKey: evento.target.checked },
                            }
                          : actual,
                      )
                    }
                  />
                  PK
                </label>
                <label className="marca-candidato">
                  <input
                    type="checkbox"
                    checked={!(command.payload.nullable ?? true)}
                    onChange={(evento) =>
                      onChange(command.commandId, (actual) =>
                        actual.type === 'ADD_ATTRIBUTE'
                          ? {
                              ...actual,
                              payload: { ...actual.payload, nullable: !evento.target.checked },
                            }
                          : actual,
                      )
                    }
                  />
                  obligatorio
                </label>
                <label className="marca-candidato">
                  <input
                    type="checkbox"
                    checked={command.payload.unique ?? false}
                    onChange={(e) =>
                      onChange(command.commandId, (actual) =>
                        actual.type === 'ADD_ATTRIBUTE'
                          ? { ...actual, payload: { ...actual.payload, unique: e.target.checked } }
                          : actual,
                      )
                    }
                  />
                  Único
                </label>
              </div>
            );
          }

          if (command.type === 'CREATE_RELATIONSHIP') {
            return (
              <div className="fila-candidato relacion-candidato" key={command.commandId}>
                <select
                  aria-label={`Tipo de relación ${numero}`}
                  value={command.payload.kind ?? 'ASSOCIATION'}
                  onChange={(e) =>
                    onChange(command.commandId, (actual) =>
                      actual.type === 'CREATE_RELATIONSHIP'
                        ? {
                            ...actual,
                            payload: {
                              ...actual.payload,
                              kind: e.target.value as (typeof RELATIONSHIP_KINDS)[number],
                            },
                          }
                        : actual,
                    )
                  }
                >
                  {RELATIONSHIP_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {kind}
                    </option>
                  ))}
                </select>
                {(['sourceClassId', 'targetClassId'] as const).map((field, i) => (
                  <label key={field}>
                    <span>{i === 0 ? 'Clase origen' : 'Clase destino'}</span>
                    <select
                      aria-label={`${i === 0 ? 'Clase origen' : 'Clase destino'} ${numero}`}
                      value={command.payload[field]}
                      onChange={(e) =>
                        onChange(command.commandId, (actual) =>
                          actual.type === 'CREATE_RELATIONSHIP'
                            ? { ...actual, payload: { ...actual.payload, [field]: e.target.value } }
                            : actual,
                        )
                      }
                    >
                      {[...nombres].map(([id, name]) => (
                        <option key={id} value={id}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
                {(['sourceRoleName', 'targetRoleName'] as const).map((field, i) => (
                  <label key={field}>
                    <span>{i === 0 ? 'Rol origen' : 'Rol destino'}</span>
                    <input
                      aria-label={`${i === 0 ? 'Rol origen' : 'Rol destino'} ${numero}`}
                      value={command.payload[field] ?? ''}
                      onChange={(e) =>
                        onChange(command.commandId, (actual) => {
                          if (actual.type !== 'CREATE_RELATIONSHIP') return actual;
                          const payload = { ...actual.payload };
                          if (e.target.value.trim() === '') delete payload[field];
                          else payload[field] = e.target.value;
                          return { ...actual, payload };
                        })
                      }
                    />
                  </label>
                ))}
                <span>
                  {nombres.get(command.payload.sourceClassId) ?? 'Clase'} →{' '}
                  {nombres.get(command.payload.targetClassId) ?? 'Clase'}
                </span>
                <select
                  value={command.payload.sourceMultiplicity}
                  aria-label={`Multiplicidad origen ${numero}`}
                  onChange={(evento) =>
                    onChange(command.commandId, (actual) =>
                      actual.type === 'CREATE_RELATIONSHIP'
                        ? {
                            ...actual,
                            payload: {
                              ...actual.payload,
                              sourceMultiplicity: evento.target
                                .value as (typeof MULTIPLICITIES)[number],
                            },
                          }
                        : actual,
                    )
                  }
                >
                  {MULTIPLICITIES.map((multiplicidad) => (
                    <option key={multiplicidad}>{multiplicidad}</option>
                  ))}
                </select>
                <span>—</span>
                <select
                  value={command.payload.targetMultiplicity}
                  aria-label={`Multiplicidad destino ${numero}`}
                  onChange={(evento) =>
                    onChange(command.commandId, (actual) =>
                      actual.type === 'CREATE_RELATIONSHIP'
                        ? {
                            ...actual,
                            payload: {
                              ...actual.payload,
                              targetMultiplicity: evento.target
                                .value as (typeof MULTIPLICITIES)[number],
                            },
                          }
                        : actual,
                    )
                  }
                >
                  {MULTIPLICITIES.map((multiplicidad) => (
                    <option key={multiplicidad}>{multiplicidad}</option>
                  ))}
                </select>
              </div>
            );
          }

          return (
            <div className="fila-candidato solo-lectura" key={command.commandId}>
              <span>{etiquetaComando(command, nombres)}</span>
            </div>
          );
        };
        return (
          <div className="operacion-candidato" key={command.commandId}>
            {render()}
            <button
              type="button"
              className="quitar"
              aria-label={`Quitar operación ${numero}`}
              onClick={() => onRemove(command.commandId)}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function etiquetaComando(command: Command, nombres: ReadonlyMap<string, string>): string {
  switch (command.type) {
    case 'CREATE_CLASS':
      return `Crear clase ${command.payload.displayName}`;
    case 'RENAME_CLASS':
      return `Renombrar a ${command.payload.displayName}`;
    case 'ADD_ATTRIBUTE':
      return `Añadir ${command.payload.displayName}: ${command.payload.type} a ${nombres.get(command.payload.classId) ?? 'clase'}`;
    case 'CREATE_RELATIONSHIP':
      return `${nombres.get(command.payload.sourceClassId) ?? 'clase'} [${command.payload.sourceRoleName ?? ''} ${command.payload.sourceMultiplicity}] → ${nombres.get(command.payload.targetClassId) ?? 'clase'} [${command.payload.targetRoleName ?? ''} ${command.payload.targetMultiplicity}] (${command.payload.kind ?? 'ASSOCIATION'})`;
    case 'UPDATE_ATTRIBUTE':
      return `Actualizar atributo de ${nombres.get(command.payload.classId) ?? 'clase'}`;
    case 'DELETE_CLASS':
      return `Eliminar clase ${nombres.get(command.payload.classId) ?? ''}`;
    case 'DELETE_ATTRIBUTE':
      return `Eliminar atributo de ${nombres.get(command.payload.classId) ?? 'clase'}`;
    case 'DELETE_RELATIONSHIP':
      return 'Eliminar relación existente';
    case 'CHANGE_MULTIPLICITY':
      return 'Cambiar multiplicidad';
    case 'UPDATE_RELATIONSHIP':
      return 'Actualizar relación';
    case 'MOVE_CLASS':
      return `Mover clase ${nombres.get(command.payload.classId) ?? ''}`;
  }
}
