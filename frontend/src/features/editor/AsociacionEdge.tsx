import type { RelationshipKind } from '@uml/contracts';
import { getStraightPath, type Edge, type EdgeProps } from '@xyflow/react';

export interface AsociacionData extends Record<string, unknown> {
  readonly origen: string;
  readonly destino: string;
  readonly rolOrigen: string | undefined;
  readonly rolDestino: string | undefined;
  readonly kind: RelationshipKind;
  readonly parallelIndex: number;
  readonly parallelCount: number;
}

export type AsociacionEdgeType = Edge<AsociacionData, 'asociacion'>;

/**
 * Asociacion dibujada como en UML 2.5.
 *
 * Tres diferencias con la arista que traia React Flow, y las tres son las que
 * hacen que un diagrama se lea como un diagrama y no como un grafo:
 *
 * **Linea recta.** Una curva de Bezier entre dos clases sugiere un flujo; en un
 * diagrama de clases la relacion es una linea, sin mas.
 *
 * **Las multiplicidades van en los extremos.** Cada una pertenece al lado que
 * toca: «1» junto a Persona y «0..*» junto a Estudiante significa una cosa, y
 * puestas juntas en el medio como «1 → 0..*» hay que recordar cual era cual.
 *
 * **El texto va dentro del SVG**, no en una capa flotante. Asi se desplaza y se
 * escala con el diagrama, y al exportar la vista sale con el.
 */
export function AsociacionEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  source,
  target,
  data,
  selected,
}: EdgeProps<AsociacionEdgeType>): React.JSX.Element {
  const esRecursiva = source === target;
  const parallelIndex = data?.parallelIndex ?? 0;
  const parallelCount = data?.parallelCount ?? 1;
  const desplazamientoCarril = (parallelIndex - (parallelCount - 1) / 2) * 24;
  const profundidadBucle = 58 + parallelIndex * 28;
  const ruta = esRecursiva
    ? rutaRecursiva(sourceX, sourceY, targetX, targetY, profundidadBucle)
    : rutaParalela(sourceX, sourceY, targetX, targetY, desplazamientoCarril);
  const path = ruta.path;

  const origen = esRecursiva
    ? { x: sourceX - 18, y: sourceY + 18 + parallelIndex * 10 }
    : desplazar(extremo(sourceX, sourceY, targetX, targetY), ruta.normal, desplazamientoCarril);
  const destino = esRecursiva
    ? { x: targetX + 18, y: targetY + 18 + parallelIndex * 10 }
    : desplazar(extremo(targetX, targetY, sourceX, sourceY), ruta.normal, desplazamientoCarril);
  const rolOrigen = esRecursiva
    ? { x: sourceX - 24, y: sourceY + 38 + parallelIndex * 14 }
    : desplazar(
        extremo(sourceX, sourceY, targetX, targetY, 42, 8),
        ruta.normal,
        desplazamientoCarril,
      );
  const rolDestino = esRecursiva
    ? { x: targetX + 24, y: targetY + 38 + parallelIndex * 14 }
    : desplazar(
        extremo(targetX, targetY, sourceX, sourceY, 42, 8),
        ruta.normal,
        desplazamientoCarril,
      );
  const kind = data?.kind ?? 'ASSOCIATION';
  const className = [
    'asociacion',
    `tipo-${kind.toLocaleLowerCase()}`,
    selected === true ? 'seleccionada' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <g className={className} data-relationship-kind={kind}>
      {/* Una franja invisible y ancha sobre la linea: una linea de un pixel es
          casi imposible de acertar con el raton. */}
      <path className="asociacion-zona" d={path} />
      <path className="asociacion-linea" d={path} />
      <RelationshipMarker
        kind={kind}
        sourceX={sourceX}
        sourceY={sourceY}
        targetX={targetX}
        targetY={targetY}
        sourceTowardX={ruta.sourceToward.x}
        sourceTowardY={ruta.sourceToward.y}
        targetTowardX={ruta.targetToward.x}
        targetTowardY={ruta.targetToward.y}
      />

      {kind !== 'GENERALIZATION' && (
        <>
          <text className="multiplicidad" x={origen.x} y={origen.y}>
            {data?.origen}
          </text>
          <text className="multiplicidad" x={destino.x} y={destino.y}>
            {data?.destino}
          </text>
        </>
      )}

      {kind !== 'GENERALIZATION' && data?.rolOrigen !== undefined && (
        <text className="rol-asociacion" x={rolOrigen.x} y={rolOrigen.y}>
          {data.rolOrigen}
        </text>
      )}
      {kind !== 'GENERALIZATION' && data?.rolDestino !== undefined && (
        <text className="rol-asociacion" x={rolDestino.x} y={rolDestino.y}>
          {data.rolDestino}
        </text>
      )}
    </g>
  );
}

function RelationshipMarker({
  kind,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourceTowardX,
  sourceTowardY,
  targetTowardX,
  targetTowardY,
}: {
  readonly kind: RelationshipKind;
  readonly sourceX: number;
  readonly sourceY: number;
  readonly targetX: number;
  readonly targetY: number;
  readonly sourceTowardX: number;
  readonly sourceTowardY: number;
  readonly targetTowardX: number;
  readonly targetTowardY: number;
}): React.JSX.Element | null {
  if (kind === 'ASSOCIATION') return null;

  if (kind === 'GENERALIZATION') {
    const angle = angleBetween(targetX, targetY, targetTowardX, targetTowardY);
    return (
      <polygon
        className="marcador-relacion triangulo"
        points="0,0 18,-9 18,9"
        transform={`translate(${targetX} ${targetY}) rotate(${angle})`}
      />
    );
  }

  const angle = angleBetween(sourceX, sourceY, sourceTowardX, sourceTowardY);
  return (
    <polygon
      className={`marcador-relacion diamante${kind === 'COMPOSITION' ? ' relleno' : ''}`}
      points="0,0 10,-7 20,0 10,7"
      transform={`translate(${sourceX} ${sourceY}) rotate(${angle})`}
    />
  );
}

interface RutaRelacion {
  readonly path: string;
  readonly normal: { x: number; y: number };
  /** Primer punto despues del origen y ultimo punto antes del destino. */
  readonly sourceToward: { x: number; y: number };
  readonly targetToward: { x: number; y: number };
}

function rutaRecursiva(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  profundidad: number,
): RutaRelacion {
  const sourceToward = { x: sourceX, y: sourceY + profundidad };
  const targetToward = { x: targetX, y: targetY + profundidad };
  return {
    path:
      `M${sourceX} ${sourceY} L${sourceToward.x} ${sourceToward.y} ` +
      `L${targetToward.x} ${targetToward.y} L${targetX} ${targetY}`,
    normal: { x: 0, y: 0 },
    sourceToward,
    targetToward,
  };
}

function rutaParalela(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  carril: number,
): RutaRelacion {
  if (carril === 0) {
    return {
      path: getStraightPath({ sourceX, sourceY, targetX, targetY })[0],
      normal: normalEntre(sourceX, sourceY, targetX, targetY),
      sourceToward: { x: targetX, y: targetY },
      targetToward: { x: sourceX, y: sourceY },
    };
  }

  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  const largo = Math.hypot(dx, dy) || 1;
  const direccion = { x: dx / largo, y: dy / largo };
  const normal = { x: -direccion.y, y: direccion.x };
  const guia = Math.min(32, largo / 3);
  const sourceToward = {
    x: sourceX + direccion.x * guia + normal.x * carril,
    y: sourceY + direccion.y * guia + normal.y * carril,
  };
  const targetToward = {
    x: targetX - direccion.x * guia + normal.x * carril,
    y: targetY - direccion.y * guia + normal.y * carril,
  };

  return {
    path:
      `M${sourceX} ${sourceY} L${sourceToward.x} ${sourceToward.y} ` +
      `L${targetToward.x} ${targetToward.y} L${targetX} ${targetY}`,
    normal,
    sourceToward,
    targetToward,
  };
}

function normalEntre(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
): { x: number; y: number } {
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  const largo = Math.hypot(dx, dy) || 1;
  return { x: -dy / largo, y: dx / largo };
}

function desplazar(
  punto: { x: number; y: number },
  normal: { x: number; y: number },
  distancia: number,
): { x: number; y: number } {
  return { x: punto.x + normal.x * distancia, y: punto.y + normal.y * distancia };
}

function angleBetween(fromX: number, fromY: number, toX: number, toY: number): number {
  return (Math.atan2(toY - fromY, toX - fromX) * 180) / Math.PI;
}

/**
 * Donde va la etiqueta de un extremo: separada de la clase y a un lado de la
 * linea, como la coloca cualquier herramienta UML.
 */
function extremo(
  x: number,
  y: number,
  haciaX: number,
  haciaY: number,
  separacion = 18,
  ajusteVertical = -6,
): { x: number; y: number } {
  const dx = haciaX - x;
  const dy = haciaY - y;
  const largo = Math.hypot(dx, dy) || 1;

  return {
    x: x + (dx / largo) * separacion,
    // Por encima de la linea, salvo cuando la linea es casi vertical: ahi
    // estorbaria, y se aparta al lado.
    y: y + (dy / largo) * separacion + (Math.abs(dy / largo) > 0.8 ? 0 : ajusteVertical),
  };
}
