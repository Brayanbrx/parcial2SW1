import { useEffect, useId, useState } from 'react';
import {
  CLASSIFIER_KINDS,
  CONCEPTUAL_TYPES,
  VISIBILITIES,
  VISIBILITY_SYMBOLS,
  multiplicityBounds,
  type BoardState,
  type ClassifierKind,
  type UmlAttribute,
  type UmlClass,
  type UmlOperation,
  type UmlParameter,
  type Visibility,
} from '@uml/contracts';
import { gui, newId, type CommandBody } from './commands.js';

const KIND_LABELS = {
  CLASS: 'Clase',
  INTERFACE: 'Interfaz',
  ENUMERATION: 'Enumeración',
  DATA_TYPE: 'Tipo de datos',
};
const VISIBILITY_LABELS = {
  public: 'Pública',
  private: 'Privada',
  protected: 'Protegida',
  package: 'De paquete',
};
type Run = (...commands: readonly CommandBody[]) => void;

/** Local drafts prevent partial names and ranges from reaching the shared model. */
export function UmlInput({
  label,
  value,
  disabled,
  onCommit,
  validate,
  list,
  testId,
  allowEmpty = false,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onCommit(value: string): void;
  validate?: ((value: string) => boolean) | undefined;
  list?: string | undefined;
  testId?: string | undefined;
  allowEmpty?: boolean;
}): React.JSX.Element {
  const [draft, setDraft] = useState(value);
  const [invalid, setInvalid] = useState(false);
  const errorId = useId();
  useEffect(() => {
    setDraft(value);
    setInvalid(false);
  }, [value]);
  const commit = () => {
    const text = draft.trim();
    if ((!allowEmpty && text === '') || (validate && !validate(text))) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (text !== value) onCommit(text);
  };
  return (
    <label className="uml-field">
      <span>{label}</span>
      <input
        aria-label={label}
        value={draft}
        disabled={disabled}
        list={list}
        data-testid={testId}
        aria-invalid={invalid}
        aria-describedby={invalid ? errorId : undefined}
        onChange={(event) => {
          setDraft(event.target.value);
          setInvalid(false);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          }
          if (event.key === 'Escape') {
            setDraft(value);
            setInvalid(false);
            event.stopPropagation();
          }
        }}
      />
      {invalid && (
        <small id={errorId} role="alert">
          {validate
            ? 'Usa un valor válido, por ejemplo 1, 0..1 o 2..5 para multiplicidades.'
            : 'Escribe un valor.'}
        </small>
      )}
    </label>
  );
}

export function VisibilityField({
  value,
  disabled,
  onChange,
  label = 'Visibilidad',
}: {
  value: Visibility;
  disabled: boolean;
  onChange(value: Visibility): void;
  label?: string;
}): React.JSX.Element {
  return (
    <label className="uml-field">
      <span>{label}</span>
      <select
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as Visibility)}
      >
        {VISIBILITIES.map((v) => (
          <option key={v} value={v}>
            {VISIBILITY_SYMBOLS[v]} {VISIBILITY_LABELS[v]}
          </option>
        ))}
      </select>
    </label>
  );
}

export function UmlCheckbox({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange(value: boolean): void;
}): React.JSX.Element {
  return (
    <label className="uml-checkbox">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

export function ClassifierProperties({
  umlClass: c,
  state,
  canWrite,
  run,
}: {
  umlClass: UmlClass;
  state: BoardState;
  canWrite: boolean;
  run: Run;
}): React.JSX.Element {
  const list = useId();
  const [newName, setNewName] = useState('');
  return (
    <section className="uml-properties" aria-label="Propiedades UML">
      <label>
        <span>Tipo de elemento</span>
        <select
          value={c.kind ?? 'CLASS'}
          disabled={!canWrite}
          data-testid="tipo-clasificador"
          onChange={(e) =>
            run(
              gui.updateClass(c.id, {
                kind: e.target.value as ClassifierKind,
                literals: [],
                isAbstract: false,
              }),
            )
          }
        >
          {CLASSIFIER_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {KIND_LABELS[kind]}
            </option>
          ))}
        </select>
      </label>
      {c.kind !== 'INTERFACE' && c.kind !== 'ENUMERATION' && (
        <UmlCheckbox
          label="Abstracta"
          checked={c.isAbstract ?? false}
          disabled={!canWrite}
          onChange={(isAbstract) => run(gui.updateClass(c.id, { isAbstract }))}
        />
      )}
      {c.kind === 'ENUMERATION' && (
        <>
          <h3>Literales</h3>
          <ul className="uml-literals">
            {(c.literals ?? []).map((literal, index) => (
              <li key={index}>
                <UmlInput
                  label={`Literal ${index + 1}`}
                  value={literal}
                  disabled={!canWrite}
                  onCommit={(value) =>
                    run(
                      gui.updateClass(c.id, {
                        literals: c.literals?.map((s, i) => (i === index ? value : s)) ?? [],
                      }),
                    )
                  }
                />
                <button
                  type="button"
                  disabled={!canWrite}
                  aria-label={`Eliminar literal ${literal}`}
                  onClick={() =>
                    run(
                      gui.updateClass(c.id, {
                        literals: c.literals?.filter((_, i) => i !== index) ?? [],
                      }),
                    )
                  }
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          <form
            className="uml-add"
            onSubmit={(e) => {
              e.preventDefault();
              const value = newName.trim();
              if (value && !c.literals?.includes(value)) {
                run(gui.updateClass(c.id, { literals: [...(c.literals ?? []), value] }));
                setNewName('');
              }
            }}
          >
            <input
              aria-label="Nuevo literal"
              placeholder="Nuevo literal"
              value={newName}
              disabled={!canWrite}
              onChange={(e) => setNewName(e.target.value)}
            />
            <button disabled={!canWrite || !newName.trim() || c.literals?.includes(newName.trim())}>
              Añadir literal
            </button>
          </form>
        </>
      )}
      <datalist id={list}>
        {[
          ...new Set([
            ...CONCEPTUAL_TYPES,
            'Real',
            'UnlimitedNatural',
            ...state.semantic.classes.map((item) => item.displayName),
          ]),
        ].map((type) => (
          <option key={type} value={type} />
        ))}
      </datalist>
      <h3>Operaciones</h3>
      {(c.operations ?? []).map((operation) => (
        <OperationProperties
          key={operation.id}
          operation={operation}
          classId={c.id}
          disabled={!canWrite}
          list={list}
          run={run}
        />
      ))}
      <button
        type="button"
        data-testid="agregar-operacion"
        disabled={!canWrite}
        onClick={() =>
          run(
            gui.addOperation(c.id, {
              id: newId(),
              displayName: `operacion${(c.operations?.length ?? 0) + 1}`,
              visibility: 'public',
              isStatic: false,
              isAbstract: c.kind === 'INTERFACE',
              parameters: [],
            }),
          )
        }
      >
        + Operación
      </button>
    </section>
  );
}

function OperationProperties({
  operation: o,
  classId,
  disabled,
  list,
  run,
}: {
  operation: UmlOperation;
  classId: string;
  disabled: boolean;
  list: string;
  run: Run;
}): React.JSX.Element {
  const update = (changes: Partial<Omit<UmlOperation, 'id'>>) =>
    run(gui.updateOperation(classId, o.id, changes));
  const parameter = (id: string, changes: Partial<UmlParameter>) =>
    update({ parameters: o.parameters.map((p) => (p.id === id ? { ...p, ...changes } : p)) });
  function addParameter() {
    const names = new Set(o.parameters.map((item) => item.name));
    let number = 1;
    while (names.has(`parametro${number}`)) number++;
    const id = newId();
    run(
      gui.updateOperation(
        classId,
        o.id,
        {
          parameters: [
            ...o.parameters,
            { id, name: `parametro${number}`, type: 'String', direction: 'in' },
          ],
        },
        id,
      ),
    );
  }
  return (
    <details className="uml-operation" open>
      <summary>{o.displayName}()</summary>
      <UmlInput
        label="Nombre de operación"
        value={o.displayName}
        disabled={disabled}
        onCommit={(displayName) => update({ displayName })}
      />
      <VisibilityField
        value={o.visibility}
        disabled={disabled}
        onChange={(visibility) => update({ visibility })}
      />
      <UmlInput
        label="Tipo de retorno (vacío: sin retorno)"
        value={o.returnType ?? ''}
        disabled={disabled}
        list={list}
        allowEmpty
        onCommit={(returnType) => update({ returnType: returnType || 'void' })}
      />
      <UmlInput
        label="Multiplicidad del retorno"
        value={o.returnMultiplicity ?? '1'}
        disabled={disabled}
        validate={(s) => multiplicityBounds(s) !== null}
        onCommit={(returnMultiplicity) => update({ returnMultiplicity })}
      />
      <UmlCheckbox
        label="Operación abstracta"
        checked={o.isAbstract}
        disabled={disabled}
        onChange={(isAbstract) =>
          update({ isAbstract, ...(isAbstract ? { isStatic: false } : {}) })
        }
      />
      <UmlCheckbox
        label="Operación estática"
        checked={o.isStatic}
        disabled={disabled}
        onChange={(isStatic) => update({ isStatic, ...(isStatic ? { isAbstract: false } : {}) })}
      />
      <h4>Parámetros</h4>
      {o.parameters.map((p, index) => (
        <fieldset key={p.id} className="uml-parameter">
          <legend>Parámetro {index + 1}</legend>
          <UmlInput
            label="Nombre del parámetro"
            value={p.name}
            disabled={disabled}
            onCommit={(name) => parameter(p.id, { name })}
          />
          <UmlInput
            label="Tipo del parámetro"
            value={p.type}
            disabled={disabled}
            list={list}
            onCommit={(type) => parameter(p.id, { type })}
          />
          <label>
            <span>Dirección</span>
            <select
              value={p.direction}
              disabled={disabled}
              onChange={(e) =>
                parameter(p.id, { direction: e.target.value as UmlParameter['direction'] })
              }
            >
              {['in', 'out', 'inout'].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <UmlInput
            label="Multiplicidad del parámetro"
            value={p.multiplicity ?? '1'}
            disabled={disabled}
            validate={(s) => multiplicityBounds(s) !== null}
            onCommit={(multiplicity) => parameter(p.id, { multiplicity })}
          />
          <button
            type="button"
            disabled={disabled}
            onClick={() => update({ parameters: o.parameters.filter((item) => item.id !== p.id) })}
          >
            Eliminar parámetro {index + 1}
          </button>
        </fieldset>
      ))}
      <button type="button" disabled={disabled} onClick={addParameter}>
        + Parámetro
      </button>
      <button
        type="button"
        className="peligro"
        disabled={disabled}
        aria-label={`Eliminar operación ${o.displayName}`}
        onClick={() => run(gui.deleteOperation(classId, o.id))}
      >
        Eliminar operación
      </button>
    </details>
  );
}

export function AttributeProperties({
  attribute: a,
  classId,
  disabled,
  run,
}: {
  attribute: UmlAttribute;
  classId: string;
  disabled: boolean;
  run: Run;
}): React.JSX.Element {
  const update = (changes: Partial<UmlAttribute>) =>
    run(gui.updateAttribute(classId, a.id, changes));
  return (
    <details className="uml-attribute">
      <summary>Propiedades UML de {a.displayName}</summary>
      <VisibilityField
        value={a.visibility ?? 'private'}
        disabled={disabled}
        onChange={(visibility) => update({ visibility })}
      />
      <UmlInput
        label={`Multiplicidad de ${a.displayName}`}
        value={a.multiplicity ?? (a.nullable ? '0..1' : '1')}
        disabled={disabled}
        validate={(s) => multiplicityBounds(s) !== null}
        onCommit={(multiplicity) =>
          update({ multiplicity, nullable: multiplicityBounds(multiplicity)?.lower === 0 })
        }
      />
      <UmlInput
        label={`Valor predeterminado de ${a.displayName}`}
        value={a.defaultValue ?? ''}
        disabled={disabled}
        allowEmpty
        onCommit={(defaultValue) => update({ defaultValue })}
      />
      <UmlCheckbox
        label="Atributo estático"
        checked={a.isStatic ?? false}
        disabled={disabled}
        onChange={(isStatic) => update({ isStatic })}
      />
      <UmlCheckbox
        label="Atributo derivado"
        checked={a.isDerived ?? false}
        disabled={disabled}
        onChange={(isDerived) => update({ isDerived })}
      />
      <UmlCheckbox
        label="Solo lectura"
        checked={a.isReadOnly ?? false}
        disabled={disabled}
        onChange={(isReadOnly) => update({ isReadOnly })}
      />
    </details>
  );
}
