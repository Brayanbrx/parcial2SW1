import type { BoardState, Size, ValidationIssue } from '@uml/contracts';
import { resolvePrimaryKey } from '@uml/domain-core';
import {
  Background,
  ConnectionMode,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  getViewportForBounds,
  type Connection,
  type NodeChange,
  useReactFlow,
  useStore,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useTheme } from '../../components/ThemeProvider.js';
import { useEffect, useMemo, useRef } from 'react';
import { AsociacionEdge, type AsociacionEdgeType } from './AsociacionEdge.js';
import { ClassNode, type ClassNodeType } from './ClassNode.js';
import { toolLabel, type EditorTool } from './editor-tools.js';
import type { Participant } from './useBoardDocument.js';

const nodeTypes = { umlClass: ClassNode };
const edgeTypes = { asociacion: AsociacionEdge };
const FIT_VIEW_OPTIONS = { maxZoom: 1 } as const;

export interface BoardCanvasProps {
  readonly state: BoardState;
  readonly issues: readonly ValidationIssue[];
  readonly participants: readonly Participant[];
  readonly selectedId: string | null;
  /** Clase creada localmente que debe quedar completa dentro de la vista. */
  readonly revealClassId: string | null;
  readonly activeTool: EditorTool;
  readonly relationshipSourceId: string | null;
  readonly canWrite: boolean;
  onSelect(elementId: string | null): void;
  onClassClick(classId: string): void;
  onCancelTool(): void;
  onCreateClass(position: { x: number; y: number }): void;
  /**
   * Colocar o redimensionar. El tamano solo viaja cuando alguien lo cambio a
   * mano; arrastrar lo omite y el que hubiera se conserva.
   */
  onMove(classId: string, position: { x: number; y: number }, size?: Size): void;
  onConnect(sourceClassId: string, targetClassId: string): void;
}

/**
 * El lienzo es una proyeccion del documento.
 *
 * React Flow no guarda estado propio de nodos: se le entregan derivados del
 * modelo en cada render. Dejar que los gestione el lienzo crearia una segunda
 * copia que habria que reconciliar con la que llega por la red.
 */
export function BoardCanvas(props: BoardCanvasProps): React.JSX.Element {
  const { resolved: resolvedTheme } = useTheme();
  const {
    state,
    issues,
    participants,
    selectedId,
    revealClassId,
    activeTool,
    relationshipSourceId,
    canWrite,
  } = props;
  const { screenToFlowPosition, setViewport } = useReactFlow<ClassNodeType, AsociacionEdgeType>();
  const canvasWidth = useStore((store) => store.width);
  const canvasHeight = useStore((store) => store.height);
  const ultimaClaseRevelada = useRef<string | null>(null);

  // Que elementos estan implicados en un error, para pintarlos.
  const { conError, conAviso } = useMemo(() => {
    const errores = new Set<string>();
    const avisos = new Set<string>();

    for (const hallazgo of issues) {
      const destino = hallazgo.severity === 'ERROR' ? errores : avisos;
      for (const id of hallazgo.elementIds) destino.add(id);
    }
    return { conError: errores, conAviso: avisos };
  }, [issues]);

  const editoresPorElemento = useMemo(() => {
    const mapa = new Map<string, { displayName: string; color: string }>();
    for (const participante of participants) {
      if (participante.editing !== null) {
        mapa.set(participante.editing, {
          displayName: participante.displayName,
          color: participante.color,
        });
      }
    }
    return mapa;
  }, [participants]);

  const nodes: ClassNodeType[] = useMemo(
    () =>
      state.semantic.classes.map((umlClass) => {
        const resolucion = resolvePrimaryKey(umlClass);
        const medida = state.layout.sizes[umlClass.id];
        const primaryKeyId =
          resolucion.kind === 'DECLARED' || resolucion.kind === 'INFERRED'
            ? resolucion.attribute.id
            : null;

        return {
          id: umlClass.id,
          type: 'umlClass' as const,
          position: state.layout.positions[umlClass.id] ?? { x: 0, y: 0 },
          // El tamano se declara en lugar de dejar que la tarjeta crezca con su
          // contenido. Dos razones: un diagrama con tarjetas de anchos dispares
          // no se lee como un diagrama de clases, y el minimapa **solo dibuja
          // los nodos que declaran tamano** — sin esto salia un recuadro vacio.
          // El tamano elegido a mano manda sobre el calculado. Si no, anadir
          // un atributo desharia el ajuste que alguien acaba de hacer.
          width: medida?.width ?? ANCHO_NODO,
          height: medida?.height ?? altoDeNodo(umlClass.attributes.length),
          selected: umlClass.id === selectedId,
          draggable: canWrite,
          ariaLabel: `Clase ${umlClass.displayName}, ${umlClass.attributes.length} ${umlClass.attributes.length === 1 ? 'atributo' : 'atributos'}`,
          data: {
            umlClass,
            canWrite,
            primaryKeyId,
            hasError: conError.has(umlClass.id),
            hasWarning: conAviso.has(umlClass.id),
            isRelationshipSource: umlClass.id === relationshipSourceId,
            editedBy: editoresPorElemento.get(umlClass.id) ?? null,
          },
        };
      }),
    [state, selectedId, relationshipSourceId, canWrite, conError, conAviso, editoresPorElemento],
  );

  const edges: AsociacionEdgeType[] = useMemo(() => {
    const clasesExistentes = new Set(state.semantic.classes.map((item) => item.id));
    const dibujables = state.semantic.relationships.filter(
      (relacion) =>
        clasesExistentes.has(relacion.sourceClassId) &&
        clasesExistentes.has(relacion.targetClassId),
    );
    const paralelas = agruparRelacionesParalelas(dibujables);

    return dibujables.map((relacion) => {
      // Cada multiplicidad viaja por separado: van en su extremo, no juntas
      // en el medio. El rol solo aparece cuando existe, que es cuando
      // desambigua dos relaciones entre el mismo par.
      const lados = ladosMasCortos(
        state.layout,
        relacion.sourceClassId,
        relacion.targetClassId,
        state.semantic.classes,
      );
      const carril = paralelas.get(relacion.id) ?? { index: 0, count: 1 };

      const arista: AsociacionEdgeType = {
        id: relacion.id,
        type: 'asociacion',
        source: relacion.sourceClassId,
        target: relacion.targetClassId,
        sourceHandle: lados.origen,
        targetHandle: lados.destino,
        selected: relacion.id === selectedId,
        ariaLabel: `${relacion.kind ?? 'ASSOCIATION'} entre ${state.semantic.classes.find((item) => item.id === relacion.sourceClassId)?.displayName ?? 'clase'} y ${state.semantic.classes.find((item) => item.id === relacion.targetClassId)?.displayName ?? 'clase'}`,
        data: {
          origen: relacion.sourceMultiplicity,
          destino: relacion.targetMultiplicity,
          rolOrigen: relacion.sourceRoleName,
          rolDestino: relacion.targetRoleName,
          kind: relacion.kind ?? 'ASSOCIATION',
          parallelIndex: carril.index,
          parallelCount: carril.count,
        },
      };

      return conError.has(relacion.id) ? { ...arista, className: 'arista-con-error' } : arista;
    });
  }, [state.semantic.relationships, state.semantic.classes, state.layout, selectedId, conError]);

  useEffect(() => {
    if (revealClassId === null || ultimaClaseRevelada.current === revealClassId) return;
    const nueva = nodes.find((node) => node.id === revealClassId);
    if (nueva === undefined || canvasWidth === 0 || canvasHeight === 0) return;
    ultimaClaseRevelada.current = revealClassId;

    // La accion rapida de la barra crea en coordenadas del modelo. Si la vista
    // estaba centrada en otra clase, la nueva podia quedar debajo del panel
    // lateral. Solo se centra cuando es una creacion local (queda seleccionada),
    // para no moverle la camara a los demas colaboradores.
    // Sin animacion ni un frame diferido: el siguiente gesto suele ser
    // arrastrar un conector y la camara no debe moverse debajo del puntero.
    // El nodo puede no estar aun en el registro interno de React Flow. Usar
    // sus dimensiones conocidas evita que fitView omita la clase recien creada.
    void setViewport(
      getViewportForBounds(
        {
          ...nueva.position,
          width: nueva.width ?? ANCHO_NODO,
          height: nueva.height ?? altoDeNodo(nueva.data.umlClass.attributes.length),
        },
        canvasWidth,
        canvasHeight,
        0.2,
        1,
        0.25,
      ),
      { duration: 0 },
    );
  }, [canvasWidth, canvasHeight, setViewport, nodes, revealClassId]);

  return (
    <ReactFlow
      data-testid="pizarra-diagrama"
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      className={`tablero herramienta-${activeTool.toLocaleLowerCase()}`}
      // Permite unir cualquier lado con cualquier lado. Con el modo estricto
      // cada clase solo podia salir por la derecha y entrar por la izquierda,
      // asi que una relacion hacia atras dibujaba un lazo alrededor de la caja.
      connectionMode={ConnectionMode.Loose}
      nodesDraggable={canWrite}
      nodesConnectable={canWrite}
      elementsSelectable
      aria-label="Lienzo del diagrama de clases"
      ariaLabelConfig={{
        'controls.ariaLabel': 'Controles del lienzo',
        'controls.zoomIn.ariaLabel': 'Acercar',
        'controls.zoomOut.ariaLabel': 'Alejar',
        'controls.fitView.ariaLabel': 'Ajustar diagrama a la vista',
        'minimap.ariaLabel': 'Vista general del diagrama',
        'handle.ariaLabel': 'Conector de relación',
      }}
      fitView
      fitViewOptions={FIT_VIEW_OPTIONS}
      minZoom={0.2}
      maxZoom={2}
      proOptions={{ hideAttribution: true }}
      // El tema cambia la presentación, sin remontar el documento colaborativo.
      colorMode={resolvedTheme}
      onNodesChange={(cambios: NodeChange<ClassNodeType>[]) => {
        for (const cambio of cambios) {
          // Solo al soltar. Emitir un comando por cada pixel llenaria la
          // auditoria de ruido y castigaria la red sin que nadie lo note.
          if (
            cambio.type === 'position' &&
            cambio.position !== undefined &&
            cambio.dragging !== true
          ) {
            const nodo = nodes.find((item) => item.id === cambio.id);
            if (nodo !== undefined) props.onMove(cambio.id, cambio.position ?? nodo.position);
          }

          // React Flow emite `dimensions` mientras se arrastra el tirador y una
          // ultima vez al soltar, con `resizing` en falso. Solo esa ultima
          // interesa: una por pixel llenaria la auditoria de ruido.
          if (cambio.type === 'dimensions' && cambio.resizing === false) {
            const nodo = nodes.find((item) => item.id === cambio.id);
            const medida = cambio.dimensions;
            if (nodo !== undefined && medida !== undefined) {
              props.onMove(cambio.id, nodo.position, {
                width: Math.round(medida.width),
                height: Math.round(medida.height),
              });
            }
          }
        }
      }}
      onNodeClick={(_, nodo) => props.onClassClick(nodo.id)}
      onEdgeClick={(_, arista) => props.onSelect(arista.id)}
      onKeyDownCapture={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        const target = event.target;
        if (!(target instanceof Element)) return;

        const node = target.closest<HTMLElement>('.react-flow__node[data-id]');
        if (node !== null) {
          event.preventDefault();
          event.stopPropagation();
          const id = node.dataset.id;
          if (id !== undefined) props.onClassClick(id);
          return;
        }

        const edge = target.closest<SVGGElement>('.react-flow__edge[data-id]');
        if (edge !== null) {
          event.preventDefault();
          event.stopPropagation();
          const id = edge.dataset.id;
          if (id !== undefined) props.onSelect(id);
        }
      }}
      onPaneClick={(event) => {
        if (activeTool === 'CLASS' && canWrite) {
          const point = screenToFlowPosition({ x: event.clientX, y: event.clientY });
          props.onCreateClass({ x: point.x - ANCHO_NODO / 2, y: point.y - 48 });
          return;
        }
        props.onSelect(null);
      }}
      onConnect={(conexion: Connection) => {
        if (conexion.source !== null && conexion.target !== null) {
          props.onConnect(conexion.source, conexion.target);
        }
      }}
    >
      <Background color="var(--diagrama-punto)" gap={16} size={1} />
      {state.semantic.classes.length === 0 && activeTool === 'SELECT' && (
        <Panel
          position="top-center"
          className="estado-lienzo-vacio"
          data-testid="lienzo-vacio"
          role="status"
          aria-live="polite"
        >
          <span className="estado-lienzo-icono" aria-hidden="true">
            +
          </span>
          <h2>{canWrite ? 'Empieza con una clase' : 'La pizarra está vacía'}</h2>
          <p>
            {canWrite
              ? 'Crea una entidad y añade sus atributos desde el panel de propiedades.'
              : 'Todavía no se han añadido clases a este diagrama.'}
          </p>
          {canWrite && (
            <button
              type="button"
              className="principal"
              onClick={() => props.onCreateClass({ x: 80, y: 80 })}
            >
              Crear primera clase
            </button>
          )}
        </Panel>
      )}
      {activeTool !== 'SELECT' && (
        <Panel position="top-left" className="modo-lienzo" data-testid="modo-lienzo">
          <span className="modo-lienzo-punto" aria-hidden="true" />
          <strong>{toolLabel(activeTool)}</strong>
          <span>
            {activeTool === 'CLASS'
              ? 'Haz clic para colocarla'
              : relationshipSourceId === null
                ? 'Elige la clase de origen'
                : 'Elige la clase de destino'}
          </span>
          <button type="button" className="cancelar-modo" onClick={props.onCancelTool}>
            Cancelar <kbd>Esc</kbd>
          </button>
        </Panel>
      )}
      <Controls showInteractive={false} />
      {/* El tamano va en `style` y no en la hoja de estilos: React Flow lee
          `style.width` y `style.height` para calcular la geometria del SVG, asi
          que encogerlo por CSS dejaba los nodos fuera del recorte — un recuadro
          vacio, que es justo lo que se veia. */}
      <MiniMap
        pannable
        zoomable
        style={{ width: 176, height: 112 }}
        nodeColor="var(--clase-borde)"
        maskColor="var(--minimapa-mascara)"
        ariaLabel="Vista general del diagrama"
      />
    </ReactFlow>
  );
}

/**
 * Carriles estables para relaciones que unen el mismo par de clases.
 *
 * Dos asociaciones distintas son validas cuando sus roles las desambiguan. Si
 * se dibujan sobre la misma linea parecen una sola y una de ellas ni siquiera
 * se puede seleccionar. El id ordenado hace que todos los colaboradores les
 * asignen el mismo carril sin sincronizar informacion de layout adicional.
 */
function agruparRelacionesParalelas(
  relaciones: BoardState['semantic']['relationships'],
): Map<string, { index: number; count: number }> {
  const grupos = new Map<string, string[]>();

  for (const relacion of relaciones) {
    const extremos = [relacion.sourceClassId, relacion.targetClassId].sort();
    const clave = `${extremos[0] ?? ''}|${extremos[1] ?? ''}`;
    const existentes = grupos.get(clave) ?? [];
    existentes.push(relacion.id);
    grupos.set(clave, existentes);
  }

  const resultado = new Map<string, { index: number; count: number }>();
  for (const ids of grupos.values()) {
    ids.sort();
    ids.forEach((id, index) => resultado.set(id, { index, count: ids.length }));
  }
  return resultado;
}

/** Ancho fijo de la tarjeta de clase, en pixeles del diagrama. */
const ANCHO_NODO = 240;
const ALTO_CABECERA = 34;
const ALTO_FILA = 22;
const RELLENO_LISTA = 10;

/**
 * Alto de la tarjeta segun cuantos atributos tiene.
 *
 * Es una estimacion, no una medida: React Flow necesita el numero **antes** de
 * dibujar. Si se queda corto la tarjeta se recorta, asi que la lista de
 * atributos se deja desplazable dentro de su alto.
 */
function altoDeNodo(atributos: number): number {
  return ALTO_CABECERA + RELLENO_LISTA + Math.max(atributos, 1) * ALTO_FILA;
}

/**
 * Por que lado sale y entra cada linea.
 *
 * Se elige el par de lados que deja el trazo mas corto, que es lo que hace una
 * herramienta UML: la relacion sale por donde queda enfrente. Antes los lados
 * eran fijos —siempre derecha a izquierda— y una relacion hacia atras dibujaba
 * un lazo rodeando la caja.
 *
 * El calculo usa la disposicion, que ya esta en memoria: no hace falta medir
 * nada en el navegador.
 */
function ladosMasCortos(
  layout: BoardState['layout'],
  origenId: string,
  destinoId: string,
  clases: BoardState['semantic']['classes'],
): {
  origen: 'l' | 'r' | 't' | 'b' | 'b-loop-source';
  destino: 'l' | 'r' | 't' | 'b' | 'b-loop-target';
} {
  if (origenId === destinoId) {
    return { origen: 'b-loop-source', destino: 'b-loop-target' };
  }

  const centro = (classId: string): { x: number; y: number } => {
    const posicion = layout.positions[classId] ?? { x: 0, y: 0 };
    const medida = layout.sizes[classId];
    const atributos = clases.find((item) => item.id === classId)?.attributes.length ?? 0;

    return {
      x: posicion.x + (medida?.width ?? ANCHO_NODO) / 2,
      y: posicion.y + (medida?.height ?? altoDeNodo(atributos)) / 2,
    };
  };

  const desde = centro(origenId);
  const hasta = centro(destinoId);
  const dx = hasta.x - desde.x;
  const dy = hasta.y - desde.y;

  // El eje dominante decide: si estan mas separadas en horizontal, la linea
  // sale por un costado; si en vertical, por arriba o por abajo.
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? { origen: 'r', destino: 'l' } : { origen: 'l', destino: 'r' };
  }
  return dy >= 0 ? { origen: 'b', destino: 't' } : { origen: 't', destino: 'b' };
}
