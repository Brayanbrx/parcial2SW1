import {
  CONCEPTUAL_TYPES,
  MULTIPLICITIES,
  RELATIONSHIP_KINDS,
  type BoardState,
  type ConceptualType,
  type Multiplicity,
  type RelationshipKind,
  type UmlClass,
  type UmlRelationship,
} from '@uml/contracts';
import { ancestorsOf, buildInheritanceGraph } from '@uml/domain-core';
import { useState } from 'react';
import { gui, newId, type CommandBody } from './commands.js';

export interface InspectorProps {
  readonly state: BoardState;
  readonly selectedId: string | null;
  readonly canWrite: boolean;
  run(...commands: readonly CommandBody[]): void;
  onSelect(elementId: string | null): void;
}

/**
 * Panel de edicion del elemento seleccionado.
 *
 * Cada control emite un comando. No hay estado intermedio "pendiente de
 * guardar": lo que se ve es lo que hay en el documento, y lo que se cambia viaja
 * a los demas en el momento.
 */
export function Inspector(props: InspectorProps): React.JSX.Element {
  const { state, selectedId } = props;

  if (selectedId === null) {
    return (
      <aside className="inspector">
        <InspectorHeader title="Propiedades" detail="Nada seleccionado" />
        <div className="inspector-vacio">
          <span aria-hidden="true">↖</span>
          <p>Selecciona una clase o una relación para editar sus propiedades.</p>
          <small>También puedes recorrer el diagrama con Tab y seleccionar con Enter.</small>
        </div>
      </aside>
    );
  }

  const umlClass = state.semantic.classes.find((item) => item.id === selectedId);
  if (umlClass !== undefined) return <ClassInspector {...props} umlClass={umlClass} />;

  const relacion = state.semantic.relationships.find((item) => item.id === selectedId);
  if (relacion !== undefined) return <RelationshipInspector {...props} relationship={relacion} />;

  return (
    <aside className="inspector">
      <InspectorHeader title="Propiedades" detail="Elemento eliminado" />
      <p className="pista">Ese elemento ya no existe.</p>
    </aside>
  );
}

function ClassInspector({
  state,
  umlClass,
  canWrite,
  run,
  onSelect,
}: InspectorProps & { umlClass: UmlClass }): React.JSX.Element {
  const [nuevoAtributo, setNuevoAtributo] = useState('');

  return (
    <aside className="inspector" data-testid="inspector-clase">
      <InspectorHeader title="Propiedades" detail="Clase UML" />
      <label>
        <span>Nombre</span>
        <input
          value={umlClass.displayName}
          disabled={!canWrite}
          data-testid="nombre-clase"
          onChange={(evento) => run(gui.renameClass(umlClass.id, evento.target.value))}
        />
      </label>

      <p className="derivados" title="Nombres que se usarán al generar código y base de datos">
        <span>Código</span> <code>{umlClass.codeName}</code>
        <span aria-hidden="true">·</span>
        <span>Tabla</span> <code>{umlClass.databaseName}</code>
      </p>

      <Herencia state={state} umlClass={umlClass} onSelect={onSelect} />

      <h3>Atributos</h3>
      <ul className="lista-atributos">
        {umlClass.attributes.length === 0 && (
          <li className="atributos-vacios">Esta clase todavía no tiene atributos.</li>
        )}
        {umlClass.attributes.map((atributo) => (
          <li key={atributo.id}>
            <input
              aria-label={`Nombre del atributo ${atributo.displayName}`}
              value={atributo.displayName}
              disabled={!canWrite}
              onChange={(evento) =>
                run(
                  gui.updateAttribute(umlClass.id, atributo.id, {
                    displayName: evento.target.value,
                  }),
                )
              }
            />
            <select
              aria-label={`Tipo del atributo ${atributo.displayName}`}
              value={atributo.type}
              disabled={!canWrite}
              onChange={(evento) =>
                run(
                  gui.updateAttribute(umlClass.id, atributo.id, {
                    type: evento.target.value as ConceptualType,
                  }),
                )
              }
            >
              {CONCEPTUAL_TYPES.map((tipo) => (
                <option key={tipo} value={tipo}>
                  {tipo}
                </option>
              ))}
            </select>

            <span className="marcadores">
              <label title="Clave primaria">
                <input
                  type="checkbox"
                  aria-label={`${atributo.displayName}: clave primaria`}
                  checked={atributo.primaryKey}
                  disabled={!canWrite}
                  onChange={(evento) =>
                    run(
                      gui.updateAttribute(umlClass.id, atributo.id, {
                        primaryKey: evento.target.checked,
                      }),
                    )
                  }
                />
                Clave primaria
              </label>
              <label title="Requerido (no admite valores nulos)">
                <input
                  type="checkbox"
                  aria-label={`${atributo.displayName}: requerido`}
                  checked={!atributo.nullable}
                  disabled={!canWrite}
                  onChange={(evento) =>
                    run(
                      gui.updateAttribute(umlClass.id, atributo.id, {
                        nullable: !evento.target.checked,
                      }),
                    )
                  }
                />
                Requerido
              </label>
              <label title="Valor único">
                <input
                  type="checkbox"
                  aria-label={`${atributo.displayName}: valor único`}
                  checked={atributo.unique}
                  disabled={!canWrite}
                  onChange={(evento) =>
                    run(
                      gui.updateAttribute(umlClass.id, atributo.id, {
                        unique: evento.target.checked,
                      }),
                    )
                  }
                />
                Único
              </label>
            </span>

            <button
              type="button"
              className="quitar"
              disabled={!canWrite}
              aria-label={`Eliminar ${atributo.displayName}`}
              onClick={() => run(gui.deleteAttribute(umlClass.id, atributo.id))}
            >
              ×
            </button>
          </li>
        ))}
      </ul>

      <form
        className="nuevo-atributo"
        onSubmit={(evento) => {
          evento.preventDefault();
          const nombre = nuevoAtributo.trim();
          if (nombre === '') return;

          run(gui.addAttribute(umlClass.id, newId(), nombre, 'String'));
          setNuevoAtributo('');
        }}
      >
        <input
          aria-label="Nombre del nuevo atributo"
          placeholder="Nuevo atributo"
          value={nuevoAtributo}
          disabled={!canWrite}
          data-testid="nuevo-atributo"
          onChange={(evento) => setNuevoAtributo(evento.target.value)}
        />
        <button type="submit" disabled={!canWrite}>
          Añadir
        </button>
      </form>

      <button
        type="button"
        className="peligro"
        disabled={!canWrite}
        onClick={() => {
          run(gui.deleteClass(umlClass.id));
          onSelect(null);
        }}
      >
        Eliminar clase
      </button>
    </aside>
  );
}

/**
 * Lo que la clase recibe por herencia, y de quien.
 *
 * La lista de atributos de esta clase muestra solo los suyos, como en cualquier
 * herramienta UML. Pero desde que la generalizacion se genera de verdad
 * (RM-07), lo heredado aparece en la tabla, en el DTO y en la ruta REST de esta
 * clase, y la clave primaria ni siquiera esta aqui: viene de la raiz. Sin este
 * resumen, la unica forma de saberlo es abrir el ZIP.
 *
 * Es solo lectura: un atributo heredado se edita donde se declaro, y el enlace
 * lleva justo ahi.
 */
function Herencia({
  state,
  umlClass,
  onSelect,
}: {
  readonly state: BoardState;
  readonly umlClass: UmlClass;
  onSelect(elementId: string | null): void;
}): React.JSX.Element | null {
  const grafo = buildInheritanceGraph(state.semantic);
  const ancestros = ancestorsOf(grafo, umlClass.id);
  const subclases = grafo.subclassesById.get(umlClass.id) ?? [];
  if (ancestros.length === 0 && subclases.length === 0) return null;

  const clase = (classId: string): UmlClass | undefined =>
    state.semantic.classes.find((item) => item.id === classId);

  const superclase = clase(ancestros[0] as string);
  const raiz = clase(ancestros[ancestros.length - 1] as string);
  // De la raiz hacia abajo, que es el orden en que se emiten.
  const heredados = [...ancestros].reverse().flatMap((id) => clase(id)?.attributes ?? []);

  return (
    <div className="herencia" data-testid="herencia-clase">
      {superclase !== undefined && (
        <p>
          Hereda de{' '}
          <button type="button" className="enlace-clase" onClick={() => onSelect(superclase.id)}>
            {superclase.displayName}
          </button>
          {raiz !== undefined && raiz.id !== superclase.id && <> · raíz {raiz.displayName}</>}
        </p>
      )}

      {heredados.length > 0 && (
        <ul className="atributos-heredados">
          {heredados.map((atributo) => (
            <li key={atributo.id}>
              {atributo.displayName}
              <span aria-hidden="true"> : </span>
              <span className="tipo">{atributo.type}</span>
              {atributo.primaryKey && <span className="marca-clave"> clave</span>}
            </li>
          ))}
        </ul>
      )}

      {subclases.length > 0 && (
        <p>
          Subclases:{' '}
          {subclases.map((id, indice) => {
            const subclase = clase(id);
            if (subclase === undefined) return null;
            return (
              <span key={id}>
                {indice > 0 && ', '}
                <button
                  type="button"
                  className="enlace-clase"
                  onClick={() => onSelect(subclase.id)}
                >
                  {subclase.displayName}
                </button>
              </span>
            );
          })}
        </p>
      )}
    </div>
  );
}

function RelationshipInspector({
  state,
  relationship,
  canWrite,
  run,
  onSelect,
}: InspectorProps & { relationship: UmlRelationship }): React.JSX.Element {
  const nombre = (classId: string): string =>
    state.semantic.classes.find((item) => item.id === classId)?.displayName ?? '?';
  const relationshipKind = relationship.kind ?? 'ASSOCIATION';
  const esRecursiva = relationship.sourceClassId === relationship.targetClassId;

  return (
    <aside className="inspector" data-testid="inspector-relacion">
      <InspectorHeader title="Propiedades" detail="Relación UML" />
      <p className="derivados">
        {nombre(relationship.sourceClassId)} → {nombre(relationship.targetClassId)}
      </p>

      <label>
        <span>Tipo UML</span>
        <select
          value={relationshipKind}
          disabled={!canWrite}
          data-testid="tipo-relacion"
          onChange={(evento) =>
            run(
              gui.updateRelationship(relationship.id, {
                kind: evento.target.value as RelationshipKind,
              }),
            )
          }
        >
          {RELATIONSHIP_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {RELATIONSHIP_LABELS[kind]}
            </option>
          ))}
        </select>
      </label>

      <p className="pista-relacion">{RELATIONSHIP_HELP[relationshipKind]}</p>

      {relationshipKind !== 'GENERALIZATION' && (
        <>
          <h3>Extremos</h3>
          <div className="extremos-relacion">
            <fieldset>
              <legend>
                {nombre(relationship.sourceClassId)}
                {esRecursiva && ' · origen'}
              </legend>
              <label>
                <span>Multiplicidad</span>
                <select
                  value={relationship.sourceMultiplicity}
                  disabled={!canWrite}
                  data-testid="multiplicidad-origen"
                  onChange={(evento) =>
                    run(
                      gui.changeMultiplicity(relationship.id, evento.target.value as Multiplicity),
                    )
                  }
                >
                  {MULTIPLICITIES.map((valor) => (
                    <option key={valor} value={valor}>
                      {valor}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Nombre del rol</span>
                <input
                  value={relationship.sourceRoleName ?? ''}
                  disabled={!canWrite}
                  data-testid="rol-origen"
                  placeholder="Sin rol"
                  onChange={(evento) =>
                    run(
                      gui.updateRelationship(relationship.id, {
                        sourceRoleName:
                          evento.target.value.trim() === '' ? null : evento.target.value,
                      }),
                    )
                  }
                />
              </label>
            </fieldset>

            <fieldset>
              <legend>
                {nombre(relationship.targetClassId)}
                {esRecursiva && ' · destino'}
              </legend>
              <label>
                <span>Multiplicidad</span>
                <select
                  value={relationship.targetMultiplicity}
                  disabled={!canWrite}
                  data-testid="multiplicidad-destino"
                  onChange={(evento) =>
                    run(
                      gui.changeMultiplicity(
                        relationship.id,
                        undefined,
                        evento.target.value as Multiplicity,
                      ),
                    )
                  }
                >
                  {MULTIPLICITIES.map((valor) => (
                    <option key={valor} value={valor}>
                      {valor}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Nombre del rol</span>
                <input
                  value={relationship.targetRoleName ?? ''}
                  disabled={!canWrite}
                  data-testid="rol-destino"
                  placeholder="Sin rol"
                  onChange={(evento) =>
                    run(
                      gui.updateRelationship(relationship.id, {
                        targetRoleName:
                          evento.target.value.trim() === '' ? null : evento.target.value,
                      }),
                    )
                  }
                />
              </label>
            </fieldset>
          </div>
        </>
      )}

      <button
        type="button"
        className="peligro"
        disabled={!canWrite}
        onClick={() => {
          run(gui.deleteRelationship(relationship.id));
          onSelect(null);
        }}
      >
        Eliminar relación
      </button>
    </aside>
  );
}

function InspectorHeader({
  title,
  detail,
}: {
  readonly title: string;
  readonly detail: string;
}): React.JSX.Element {
  return (
    <header className="inspector-header">
      <h2>{title}</h2>
      <span>{detail}</span>
    </header>
  );
}

const RELATIONSHIP_LABELS: Readonly<Record<RelationshipKind, string>> = {
  ASSOCIATION: 'Asociación',
  GENERALIZATION: 'Generalización',
  COMPOSITION: 'Composición',
  AGGREGATION: 'Agregación',
};

const RELATIONSHIP_HELP: Readonly<Record<RelationshipKind, string>> = {
  ASSOCIATION: 'Vínculo estructural entre dos clases.',
  GENERALIZATION: 'El origen es la subclase y el destino la superclase.',
  COMPOSITION: 'El origen representa el todo y controla el ciclo de vida de la parte.',
  AGGREGATION: 'El origen representa el todo; la parte puede existir por separado.',
};
