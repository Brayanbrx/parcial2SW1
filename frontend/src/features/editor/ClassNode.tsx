import {
  CONCEPTUAL_TYPES,
  VISIBILITY_SYMBOLS,
  attributeMultiplicityLabel,
  operationNotation,
  MIN_CLASS_HEIGHT,
  MIN_CLASS_WIDTH,
  type UmlAttribute,
  type UmlClass,
} from '@uml/contracts';
import {
  Handle,
  NodeResizer,
  NodeToolbar,
  Position,
  useUpdateNodeInternals,
  type NodeProps,
  type Node,
} from '@xyflow/react';
import { useEffect, useRef, useState } from 'react';
import { parseAttributeText, reorderAttributes } from './attribute-order.js';
import { useCanvasEditing } from './canvas-editing.js';
import { gui, newId } from './commands.js';

export interface ClassNodeData extends Record<string, unknown> {
  readonly umlClass: UmlClass;
  readonly typeNames?: readonly string[];
  /** Quien no puede escribir tampoco redimensiona. */
  readonly canWrite: boolean;
  /** Clave primaria resuelta, para marcarla aunque no este declarada. */
  readonly primaryKeyId: string | null;
  readonly hasError: boolean;
  readonly hasWarning: boolean;
  /** Primera clase elegida al construir una relacion desde el toolbox. */
  readonly isRelationshipSource: boolean;
  /** Quien la esta editando ahora mismo, si alguien. */
  readonly editedBy: { displayName: string; color: string } | null;
}

export type ClassNodeType = Node<ClassNodeData, 'umlClass'>;

/** Clases que React Flow respeta: no mover el nodo, no desplazar, no atajos. */
const INTERACTIVO = 'nodrag nopan nokey';

/**
 * Tarjeta de una clase.
 *
 * Muestra los tres nombres de forma escalonada: el visual grande, y el tecnico
 * debajo solo cuando difiere. Asi el usuario ve como va a quedar la tabla sin
 * tener que abrir nada, que es donde se detectan las colisiones a simple vista.
 *
 * Se edita sobre el propio diagrama: doble clic en el nombre o en un atributo,
 * el asa ⠿ para reordenar (o Alt+↑/↓), × para quitar y «+ Atributo» debajo de
 * la tarjeta seleccionada. El inspector sigue ofreciendo lo mismo y más.
 */
export function ClassNode({
  id,
  data,
  selected,
  width,
  height,
}: NodeProps<ClassNodeType>): React.JSX.Element {
  const updateNodeInternals = useUpdateNodeInternals();
  useEffect(() => {
    // El lienzo reconstruye los nodos desde Yjs sin conservar `measured`.
    // React Flow invalida entonces sus conectores, incluso cuando solo cambia
    // la presencia. Medimos despues de montar/actualizar esta tarjeta: hacerlo
    // solo al cambiar los extremos dejaba relaciones remotas sin dibujar.
    // La seleccion tambien mueve el conector rapido mediante CSS.
    updateNodeInternals(id);
  }, [id, data, selected, width, height, updateNodeInternals]);

  const { umlClass, hasError, hasWarning, isRelationshipSource, editedBy, canWrite } = data;
  const edicion = useCanvasEditing();
  const editable = canWrite && edicion !== null;
  const seleccionada = selected === true;

  /** 'nombre', el id del atributo en edición, o null. */
  const [editando, setEditando] = useState<string | null>(null);
  const [agregando, setAgregando] = useState(false);
  const [arrastre, setArrastre] = useState<{ attributeId: string; destino: number | null } | null>(
    null,
  );
  const lista = useRef<HTMLUListElement>(null);
  const focoPendiente = useRef<string | null>(null);

  useEffect(() => {
    if (!seleccionada) setAgregando(false);
  }, [seleccionada]);
  useEffect(() => {
    // Devuelve el foco a la fila que se movió.
    const pendiente = focoPendiente.current;
    if (pendiente === null) return;
    focoPendiente.current = null;
    lista.current?.querySelector<HTMLElement>(`[data-atributo="${pendiente}"]`)?.focus();
  }, [umlClass.attributes]);

  function mover(desde: number, hacia: number) {
    const comandos = reorderAttributes(umlClass, desde, hacia);
    if (comandos.length === 0 || edicion === null) return;
    focoPendiente.current = umlClass.attributes[desde]?.id ?? null;
    edicion.run(...comandos);
  }

  const clases = [
    'nodo-clase',
    seleccionada ? 'seleccionado' : '',
    isRelationshipSource ? 'origen-relacion' : '',
    hasError ? 'con-error' : hasWarning ? 'con-aviso' : '',
    editable ? 'editable' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={clases}
      data-testid={`clase-${umlClass.codeName}`}
      style={editedBy === null ? undefined : { outline: `2px solid ${editedBy.color}` }}
    >
      {/* Los tiradores solo aparecen con la tarjeta seleccionada: visibles
          siempre, cuatro esquinas por clase convierten el diagrama en un
          erizo. El minimo evita encoger hasta perder el nombre de vista. */}
      <NodeResizer
        color="var(--clase-seleccion)"
        isVisible={seleccionada && canWrite}
        minWidth={MIN_CLASS_WIDTH}
        minHeight={MIN_CLASS_HEIGHT}
        lineClassName="borde-redimension"
        handleClassName="tirador-redimension"
      />

      {/* En modo Loose un conector source tambien puede recibir relaciones,
          pero el extremo de origen siempre debe resolver a un source. Por eso
          los cuatro lados son source: al mover y cruzar clases, la arista puede
          cambiar de lado sin quedarse sin un conector valido. */}
      <Handle type="source" position={Position.Top} id="t" />
      <Handle type="source" position={Position.Left} id="l" />
      <Handle
        type="source"
        position={Position.Right}
        id="r"
        className="conector-rapido"
        aria-label={`Crear asociación desde ${umlClass.displayName}`}
        title="Arrastra hacia otra clase para crear una asociación"
      />
      <Handle type="source" position={Position.Bottom} id="b" />
      {/* Dos anclajes inferiores separados forman el bucle de una asociacion
          recursiva. En modo Loose pueden actuar como ambos extremos. */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="b-loop-source"
        className="conector-bucle conector-bucle-origen"
        aria-label={`Iniciar asociación recursiva desde ${umlClass.displayName}`}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="b-loop-target"
        className="conector-bucle conector-bucle-destino"
        aria-label={`Completar asociación recursiva en ${umlClass.displayName}`}
      />

      {/* Compartimento del nombre. En UML va centrado y en negrita, y es lo
          unico que lleva la caja cuando la clase no tiene atributos. */}
      <header className={umlClass.isAbstract ? 'uml-abstract' : undefined}>
        {umlClass.kind && umlClass.kind !== 'CLASS' && (
          <span className="uml-keyword">
            «
            {
              (
                {
                  INTERFACE: 'interface',
                  ENUMERATION: 'enumeration',
                  DATA_TYPE: 'dataType',
                } as const
              )[umlClass.kind]
            }
            »
          </span>
        )}
        {editando === 'nombre' ? (
          <EntradaEnLinea
            etiqueta="Nombre de la clase"
            inicial={umlClass.displayName}
            onConfirmar={(valor) => {
              const nombre = valor.trim();
              if (nombre !== '' && nombre !== umlClass.displayName)
                edicion?.run(gui.renameClass(umlClass.id, nombre));
              setEditando(null);
            }}
            onCancelar={() => setEditando(null)}
          />
        ) : (
          <span
            className="nombre"
            title={editable ? 'Doble clic para renombrar' : undefined}
            onDoubleClick={editable ? () => setEditando('nombre') : undefined}
          >
            {umlClass.displayName}
          </span>
        )}
        {editedBy !== null && (
          <span className="editando" style={{ background: editedBy.color }}>
            {editedBy.displayName}
          </span>
        )}
      </header>

      {umlClass.kind === 'ENUMERATION' && (
        <ul className="uml-compartment uml-enumeration" aria-label="Literales">
          {(umlClass.literals ?? []).map((literal, index) => (
            <li key={index}>{literal}</li>
          ))}
        </ul>
      )}
      <ul className="atributos" ref={lista}>
        {umlClass.attributes.map((atributo, indice) => (
          <AttributeRow
            key={atributo.id}
            attribute={atributo}
            typeNames={data.typeNames ?? []}
            editable={editable}
            selected={seleccionada}
            editing={editando === atributo.id}
            dropMark={
              arrastre?.destino === indice
                ? 'antes'
                : arrastre?.destino === indice + 1 && indice === umlClass.attributes.length - 1
                  ? 'despues'
                  : null
            }
            onEdit={() => setEditando(atributo.id)}
            onCommit={(texto, original) => {
              setEditando(null);
              const leido = parseAttributeText(texto, data.typeNames);
              if (leido === null || leido.unknownType !== null) return;
              const inicial = parseAttributeText(original, data.typeNames);
              const cambios: Partial<Pick<UmlAttribute, 'displayName' | 'type' | 'visibility'>> =
                {};
              if (
                leido.visibility !== undefined &&
                leido.visibility !== inicial?.visibility &&
                leido.visibility !== atributo.visibility
              )
                cambios.visibility = leido.visibility;
              if (leido.name !== inicial?.name && leido.name !== atributo.displayName)
                cambios.displayName = leido.name;
              if (
                leido.type !== null &&
                leido.type !== inicial?.type &&
                leido.type !== atributo.type
              )
                cambios.type = leido.type;
              if (Object.keys(cambios).length > 0)
                edicion?.run(gui.updateAttribute(umlClass.id, atributo.id, cambios));
            }}
            onCancel={() => setEditando(null)}
            onDelete={() => edicion?.run(gui.deleteAttribute(umlClass.id, atributo.id))}
            onMove={(delta) => mover(indice, indice + delta)}
            onDragStart={() => setArrastre({ attributeId: atributo.id, destino: null })}
            onDragOverHalf={(mitadInferior) =>
              setArrastre((actual) =>
                actual === null ? actual : { ...actual, destino: indice + (mitadInferior ? 1 : 0) },
              )
            }
            onDrop={(mitadInferior) => {
              if (arrastre !== null) {
                const desde = umlClass.attributes.findIndex(
                  (item) => item.id === arrastre.attributeId,
                );
                const limite = indice + (mitadInferior ? 1 : 0);
                mover(desde, limite > desde ? limite - 1 : limite);
              }
              setArrastre(null);
            }}
            onDragEnd={() => setArrastre(null)}
          />
        ))}
      </ul>

      {(umlClass.operations?.length ?? 0) > 0 && (
        <ul className="uml-compartment uml-operations" aria-label="Operaciones">
          {umlClass.operations?.map((operation) => (
            <li
              key={operation.id}
              data-testid={`operacion-${operation.id}`}
              className={`${operation.isAbstract ? 'uml-abstract' : ''} ${operation.isStatic ? 'uml-static' : ''}`}
            >
              {operationNotation(operation)}
            </li>
          ))}
        </ul>
      )}
      {/* Fuera de la tarjeta (que recorta su contenido): una barra contextual
          bajo la clase seleccionada para seguir escribiendo atributos. */}
      {editable && (
        <NodeToolbar isVisible={seleccionada} position={Position.Bottom} offset={14}>
          <div className={`barra-nodo ${INTERACTIVO}`}>
            {agregando ? (
              <EntradaEnLinea
                etiqueta={`Nuevo atributo de ${umlClass.displayName}`}
                inicial=""
                marcador="nombre: Tipo  (Enter para añadir otro)"
                continuo
                onConfirmar={(texto) => {
                  const leido = parseAttributeText(texto, data.typeNames);
                  if (leido === null) return false;
                  if (leido.unknownType !== null) return false;
                  edicion?.run(
                    gui.addAttribute(
                      umlClass.id,
                      newId(),
                      leido.name,
                      leido.type ?? 'String',
                      leido.visibility,
                    ),
                  );
                  return true;
                }}
                onCancelar={() => setAgregando(false)}
              />
            ) : (
              <>
                <button
                  type="button"
                  className="barra-nodo-agregar"
                  onClick={() => setAgregando(true)}
                >
                  + Atributo
                </button>
                <span className="barra-nodo-pista">
                  Doble clic para editar · ⠿ arrastra para ordenar
                </span>
              </>
            )}
          </div>
        </NodeToolbar>
      )}
    </div>
  );
}

function AttributeRow({
  attribute,
  typeNames,
  editable,
  selected,
  editing,
  dropMark,
  onEdit,
  onCommit,
  onCancel,
  onDelete,
  onMove,
  onDragStart,
  onDragOverHalf,
  onDrop,
  onDragEnd,
}: {
  attribute: UmlAttribute;
  typeNames: readonly string[];
  editable: boolean;
  selected: boolean;
  editing: boolean;
  dropMark: 'antes' | 'despues' | null;
  onEdit(): void;
  onCommit(texto: string, original: string): void;
  onCancel(): void;
  onDelete(): void;
  onMove(delta: -1 | 1): void;
  onDragStart(): void;
  onDragOverHalf(mitadInferior: boolean): void;
  onDrop(mitadInferior: boolean): void;
  onDragEnd(): void;
}): React.JSX.Element {
  if (editing)
    return (
      <li className="editando-atributo">
        <EntradaEnLinea
          etiqueta={`Atributo ${attribute.displayName}`}
          inicial={`${VISIBILITY_SYMBOLS[attribute.visibility ?? 'private']} ${attribute.displayName}: ${attribute.type}`}
          onConfirmar={(texto, original) => {
            const leido = parseAttributeText(texto, typeNames);
            if (leido?.unknownType) return false;
            onCommit(texto, original);
            return true;
          }}
          onCancelar={onCancel}
        />
      </li>
    );

  // Notacion UML: `- nombre: Tipo`. El guion es la visibilidad privada, que es
  // lo que corresponde a un atributo de una entidad de datos.
  return (
    <li
      data-atributo={attribute.id}
      className={`${attribute.isStatic ? 'uml-static' : ''} ${dropMark === null ? '' : `soltar-${dropMark}`}`}
      tabIndex={editable && selected ? 0 : undefined}
      onDoubleClick={editable ? onEdit : undefined}
      onKeyDown={
        editable
          ? (evento) => {
              if (evento.altKey && (evento.key === 'ArrowUp' || evento.key === 'ArrowDown')) {
                evento.preventDefault();
                evento.stopPropagation();
                onMove(evento.key === 'ArrowUp' ? -1 : 1);
              } else if (evento.key === 'Enter' || evento.key === 'F2') {
                evento.preventDefault();
                evento.stopPropagation();
                onEdit();
              }
            }
          : undefined
      }
      onDragOver={
        editable
          ? (evento) => {
              evento.preventDefault();
              const caja = evento.currentTarget.getBoundingClientRect();
              onDragOverHalf(evento.clientY > caja.top + caja.height / 2);
            }
          : undefined
      }
      onDrop={
        editable
          ? (evento) => {
              evento.preventDefault();
              const caja = evento.currentTarget.getBoundingClientRect();
              onDrop(evento.clientY > caja.top + caja.height / 2);
            }
          : undefined
      }
      title={editable ? 'Doble clic para editar · Alt+↑/↓ para mover' : undefined}
    >
      {editable ? (
        <span
          className={`visibilidad asa ${INTERACTIVO}`}
          draggable
          aria-hidden="true"
          title="Arrastra para cambiar el orden"
          onDragStart={(evento) => {
            evento.dataTransfer.effectAllowed = 'move';
            evento.dataTransfer.setData('text/plain', attribute.id);
            onDragStart();
          }}
          onDragEnd={onDragEnd}
        >
          <span className="guion">{VISIBILITY_SYMBOLS[attribute.visibility ?? 'private']}</span>
          <span className="agarre">⠿</span>
        </span>
      ) : (
        <span className="visibilidad" aria-hidden="true">
          {VISIBILITY_SYMBOLS[attribute.visibility ?? 'private']}
        </span>
      )}
      <span className="campo">
        {attribute.isDerived ? '/' : ''}
        {attribute.displayName}
        <span className="separador">: </span>
        <span className="tipo">{attribute.type}</span>
        {attributeMultiplicityLabel(attribute)}
        {attribute.defaultValue && <span> = {attribute.defaultValue}</span>}
        {attribute.isReadOnly && <span> {'{readOnly}'}</span>}
      </span>
      <span className="marcas">
        {editable && selected && (
          <button
            type="button"
            className={`quitar-atributo ${INTERACTIVO}`}
            aria-label={`Eliminar ${attribute.displayName}`}
            title="Eliminar atributo"
            onClick={(evento) => {
              evento.stopPropagation();
              onDelete();
            }}
          >
            ×
          </button>
        )}
      </span>
    </li>
  );
}

/**
 * Campo de texto sobre el diagrama. Enter confirma, Escape cancela y salir
 * del campo confirma, como en cualquier editor de diagramas. `onConfirmar`
 * puede devolver false para rechazar el texto sin cerrar (tipo desconocido).
 * En modo `continuo` se vacía tras confirmar para seguir escribiendo.
 */
function EntradaEnLinea({
  etiqueta,
  inicial,
  marcador,
  continuo = false,
  onConfirmar,
  onCancelar,
}: {
  etiqueta: string;
  inicial: string;
  marcador?: string;
  continuo?: boolean;
  onConfirmar(valor: string, original: string): boolean | void;
  onCancelar(): void;
}): React.JSX.Element {
  const [original] = useState(inicial);
  const [valor, setValor] = useState(original);
  const [invalido, setInvalido] = useState(false);
  const cerrado = useRef(false);
  const campo = useRef<HTMLInputElement>(null);
  useEffect(() => {
    campo.current?.focus();
    campo.current?.select();
  }, []);

  function confirmar(desdeBlur: boolean) {
    if (cerrado.current) return;
    if (!continuo && valor.trim() === original.trim()) {
      cerrado.current = true;
      onCancelar();
      return;
    }
    if (continuo && valor.trim() === '') {
      if (desdeBlur) {
        cerrado.current = true;
        onCancelar();
      }
      return;
    }
    const aceptado = onConfirmar(valor, original) !== false;
    if (!aceptado) {
      setInvalido(true);
      if (desdeBlur) {
        cerrado.current = true;
        onCancelar();
      }
      return;
    }
    setInvalido(false);
    if (continuo) setValor('');
    else cerrado.current = true;
  }

  return (
    <input
      ref={campo}
      className={`entrada-en-linea ${INTERACTIVO}${invalido ? ' invalido' : ''}`}
      aria-label={etiqueta}
      aria-invalid={invalido}
      title={invalido ? `Tipo desconocido. Usa: ${CONCEPTUAL_TYPES.join(', ')}` : undefined}
      placeholder={marcador}
      value={valor}
      spellCheck={false}
      onChange={(evento) => {
        setValor(evento.target.value);
        setInvalido(false);
      }}
      onKeyDown={(evento) => {
        evento.stopPropagation();
        if (evento.key === 'Enter') {
          evento.preventDefault();
          confirmar(false);
        } else if (evento.key === 'Escape') {
          evento.preventDefault();
          cerrado.current = true;
          onCancelar();
        }
      }}
      onBlur={() => confirmar(true)}
      onPointerDown={(evento) => evento.stopPropagation()}
      onDoubleClick={(evento) => evento.stopPropagation()}
    />
  );
}
