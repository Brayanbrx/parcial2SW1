import {
  CONCEPTUAL_TYPES,
  MULTIPLICITIES,
  RELATIONSHIP_KINDS,
  VISIBILITIES,
  type BoardState,
  type Command,
  type CommandBatch,
  type UmlOperation,
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
                  {[
                    ...new Set([...CONCEPTUAL_TYPES, ...nombres.values(), command.payload.type]),
                  ].map((tipo) => (
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

          if (command.type === 'ADD_OPERATION') {
            const operation = command.payload.operation;
            const update = (changes: Partial<UmlOperation>) =>
              onChange(command.commandId, (current) =>
                current.type === 'ADD_OPERATION'
                  ? {
                      ...current,
                      payload: {
                        ...current.payload,
                        operation: { ...current.payload.operation, ...changes },
                      },
                    }
                  : current,
              );
            return (
              <div className="fila-candidato atributo-candidato">
                <span>{nombres.get(command.payload.classId) ?? 'Clase'} · método</span>
                <input
                  aria-label={`Nombre de método ${numero}`}
                  value={operation.displayName}
                  onChange={(event) => update({ displayName: event.target.value })}
                />
                <input
                  aria-label={`Tipo de retorno ${numero}`}
                  placeholder="Sin retorno"
                  value={operation.returnType ?? ''}
                  onChange={(event) => update({ returnType: event.target.value || undefined })}
                />
                <select
                  aria-label={`Visibilidad del método ${numero}`}
                  value={operation.visibility}
                  onChange={(event) =>
                    update({ visibility: event.target.value as UmlOperation['visibility'] })
                  }
                >
                  {VISIBILITIES.map((visibility) => (
                    <option key={visibility}>{visibility}</option>
                  ))}
                </select>
                {operation.parameters.map((parameter, index) => (
                  <div key={parameter.id}>
                    <input
                      aria-label={`Nombre del parámetro ${index + 1} del método ${numero}`}
                      value={parameter.name}
                      onChange={(event) =>
                        update({
                          parameters: operation.parameters.map((p) =>
                            p.id === parameter.id ? { ...p, name: event.target.value } : p,
                          ),
                        })
                      }
                    />
                    <input
                      aria-label={`Tipo del parámetro ${index + 1} del método ${numero}`}
                      value={parameter.type}
                      onChange={(event) =>
                        update({
                          parameters: operation.parameters.map((p) =>
                            p.id === parameter.id ? { ...p, type: event.target.value } : p,
                          ),
                        })
                      }
                    />
                  </div>
                ))}
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
                  {[
                    ...new Set([
                      ...MULTIPLICITIES,
                      command.payload.sourceMultiplicity,
                      command.payload.targetMultiplicity,
                    ]),
                  ].map((multiplicidad) => (
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
                  {[
                    ...new Set([
                      ...MULTIPLICITIES,
                      command.payload.sourceMultiplicity,
                      command.payload.targetMultiplicity,
                    ]),
                  ].map((multiplicidad) => (
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
    case 'UPDATE_CLASS':
      return 'Actualizar propiedades UML del clasificador';
    case 'ADD_OPERATION':
      return `Añadir operación ${command.payload.operation.displayName}`;
    case 'UPDATE_OPERATION':
      return 'Actualizar operación';
    case 'DELETE_OPERATION':
      return 'Eliminar operación';
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
