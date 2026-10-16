import {
  MIN_CLASS_HEIGHT,
  MIN_CLASS_WIDTH,
  type UmlAttribute,
  type UmlClass,
} from '@uml/contracts';
import {
  Handle,
  NodeResizer,
  Position,
  useUpdateNodeInternals,
  type NodeProps,
  type Node,
} from '@xyflow/react';
import { useEffect } from 'react';

export interface ClassNodeData extends Record<string, unknown> {
  readonly umlClass: UmlClass;
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

/**
 * Tarjeta de una clase.
 *
 * Muestra los tres nombres de forma escalonada: el visual grande, y el tecnico
 * debajo solo cuando difiere. Asi el usuario ve como va a quedar la tabla sin
 * tener que abrir nada, que es donde se detectan las colisiones a simple vista.
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

  const { umlClass, primaryKeyId, hasError, hasWarning, isRelationshipSource, editedBy, canWrite } =
    data;
  const tecnicoDistinto = umlClass.codeName !== umlClass.displayName;

  const clases = [
    'nodo-clase',
    selected === true ? 'seleccionado' : '',
    isRelationshipSource ? 'origen-relacion' : '',
    hasError ? 'con-error' : hasWarning ? 'con-aviso' : '',
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
        isVisible={selected === true && canWrite}
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
      <header>
        <span className="nombre">{umlClass.displayName}</span>
        {tecnicoDistinto && <span className="tecnico">{umlClass.databaseName}</span>}
        {editedBy !== null && (
          <span className="editando" style={{ background: editedBy.color }}>
            {editedBy.displayName}
          </span>
        )}
      </header>

      <ul className="atributos">
        {umlClass.attributes.length === 0 && <li className="vacio">sin atributos</li>}
        {umlClass.attributes.map((atributo) => (
          <AttributeRow
            key={atributo.id}
            attribute={atributo}
            isPrimaryKey={atributo.id === primaryKeyId}
          />
        ))}
      </ul>
    </div>
  );
}

function AttributeRow({
  attribute,
  isPrimaryKey,
}: {
  attribute: UmlAttribute;
  isPrimaryKey: boolean;
}): React.JSX.Element {
  // Notacion UML: `- nombre: Tipo`. El guion es la visibilidad privada, que es
  // lo que corresponde a un atributo de una entidad de datos.
  return (
    <li>
      <span className="visibilidad" aria-hidden="true">
        -
      </span>
      <span className="campo">
        {attribute.displayName}
        <span className="separador">: </span>
        <span className="tipo">{attribute.type}</span>
        {!attribute.nullable && !isPrimaryKey && (
          <abbr className="obligatorio" title="obligatorio">
            {' '}
            *
          </abbr>
        )}
      </span>
      <span className="marcas">
        {isPrimaryKey && (
          <abbr className="pk" title="clave primaria">
            PK
          </abbr>
        )}
        {attribute.unique && !isPrimaryKey && (
          <abbr className="uq" title="unico">
            U
          </abbr>
        )}
      </span>
    </li>
  );
}
