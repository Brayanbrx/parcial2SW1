import { hasErrors, type Position, type RelationshipKind } from '@uml/contracts';
import { ReactFlowProvider } from '@xyflow/react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  api,
  ApiError,
  isConnectionUnavailable,
  flushAuditQueue,
  pendingAuditCount,
  subscribeAuditQueue,
} from '../../lib/api.js';
import { useSession } from '../auth/session.js';
import { AssistantPanel } from '../assistant/AssistantPanel.js';
import { GenerationPanel } from '../generation/GenerationPanel.js';
import { ImportPanel } from '../import/ImportPanel.js';
import { BoardCanvas } from './BoardCanvas.js';
import { EditorToolbox } from './EditorToolbox.js';
import { Inspector } from './Inspector.js';
import { ValidationPanel } from './ValidationPanel.js';
import { gui, makeBatch, newId, type CommandBody } from './commands.js';
import { isRelationshipTool, relationshipKindFor, type EditorTool } from './editor-tools.js';
import { useBoardDocument } from './useBoardDocument.js';
import { ThemeSelect } from '../../components/ThemeProvider.js';
import { SoftwareGuide } from '../help/SoftwareGuide.js';
import { cachedBoard, forgetBoard, type OfflineBoard } from '../../lib/offline.js';

type Herramienta = 'asistente' | 'importar' | 'generar';

const HERRAMIENTAS: readonly (readonly [Herramienta, string])[] = [
  ['asistente', 'Asistente'],
  ['importar', 'Importar'],
  ['generar', 'Generar'],
];

const ESTADO_CONEXION = {
  conectando: 'Conectando…',
  conectado: 'En vivo',
  desconectado: 'Sin conexión',
  rechazado: 'Acceso denegado',
} as const;

export function BoardPage(): React.JSX.Element {
  const { boardId } = useParams<{ boardId: string }>();
  const { user } = useSession();
  const [selection, setSelection] = useState<{ boardId: string; id: string | null } | null>(null);
  const select = useCallback(
    (id: string | null) => {
      if (boardId !== undefined) setSelection({ boardId, id });
    },
    [boardId],
  );

  if (boardId === undefined) {
    return (
      <main className="centrado">
        <div className="estado-ruta" role="alert">
          <h1>Esa dirección no lleva a ninguna pizarra</h1>
          <p>Puede que el enlace esté incompleto.</p>
          <Link to="/proyectos">Volver a mis proyectos</Link>
        </div>
      </main>
    );
  }

  // React conserva el componente cuando solo cambia un parametro de ruta. La
  // clave fuerza una sesion nueva y, con ella, un Y.Doc nuevo: el contenido de
  // una pizarra nunca puede viajar a la siguiente por reutilizar el hook.
  return (
    <BoardLoader
      key={`${user?.id}:${boardId}`}
      boardId={boardId}
      selectedId={selection?.boardId === boardId ? selection.id : null}
      setSelectedId={select}
    />
  );
}

interface BoardSelectionProps {
  readonly boardId: string;
  readonly selectedId: string | null;
  readonly setSelectedId: (id: string | null) => void;
}

/** Keep the local editor mounted until both the session and board API recover. */
function BoardLoader(props: BoardSelectionProps): React.JSX.Element {
  const { user, offline: sessionOffline } = useSession();
  const [board, setBoard] = useState<OfflineBoard | null>(null);
  const [offline, setOffline] = useState(sessionOffline);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user === null) return;
    let active = true;
    let inFlight = false;
    let retry = false;
    const controller = new AbortController();
    const openLocal = (): void => {
      const local = cachedBoard(user.id, props.boardId);
      if (local === null) {
        setError('Esta pizarra no está disponible sin conexión. Ábrela con conexión primero.');
      } else {
        setBoard(local);
        setOffline(true);
        setError(null);
      }
    };
    const load = async (): Promise<void> => {
      if (!active || inFlight) return;
      if (sessionOffline) {
        openLocal();
        return;
      }
      inFlight = true;
      try {
        const remote = await api.getBoard(
          props.boardId,
          AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
        );
        if (!active) return;
        setBoard(remote);
        setOffline(false);
        setError(null);
        retry = false;
      } catch (cause) {
        if (!active) return;
        if (isConnectionUnavailable(cause)) {
          retry = true;
          openLocal();
        } else {
          retry = false;
          if (cause instanceof ApiError && [403, 404].includes(cause.status))
            forgetBoard(user.id, props.boardId);
          setBoard(null);
          setError(cause instanceof Error ? cause.message : 'No se pudo abrir la pizarra.');
        }
      } finally {
        inFlight = false;
      }
    };
    void load();
    const reconnect = (): void => {
      if (retry && navigator.onLine) void load();
    };
    const timer = window.setInterval(reconnect, 5000);
    window.addEventListener('online', reconnect);
    window.addEventListener('focus', reconnect);
    return () => {
      active = false;
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener('online', reconnect);
      window.removeEventListener('focus', reconnect);
    };
  }, [props.boardId, user, sessionOffline]);

  if (error !== null)
    return (
      <main className="centrado">
        <div className="estado-ruta" role="alert">
          <h1>No se pudo abrir la pizarra</h1>
          <p className="error">{error}</p>
          <Link to="/proyectos">Volver a mis proyectos</Link>
        </div>
      </main>
    );
  if (board === null)
    return (
      <main className="centrado">
        <div className="estado-ruta" role="status">
          <div className="girando" aria-hidden="true" />
          <p>Abriendo la pizarra…</p>
        </div>
      </main>
    );
  // Sin `key`: cambiar de modo no remonta el editor. La réplica limpia de Yjs
  // la crea `useBoardDocument`, que es quien sabe cuándo hace falta; remontar
  // desde aquí tiraba además la conversación del asistente y el candidato de
  // importación en curso, que es trabajo que puede haber costado una llamada
  // de IA y que el usuario no ha pedido descartar.
  return <BoardSession {...props} board={board} offline={offline} />;
}

function BoardSession({
  boardId,
  selectedId,
  setSelectedId,
  board,
  offline,
}: BoardSelectionProps & {
  readonly board: OfflineBoard;
  readonly offline: boolean;
}): React.JSX.Element {
  const { user, logout } = useSession();
  const [shellReady, setShellReady] = useState(false);
  useEffect(() => {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator) || !window.isSecureContext) return;
    let active = true;
    void navigator.serviceWorker.ready.then(() => {
      if (active) setShellReady(true);
    });
    return () => {
      active = false;
    };
  }, []);

  const [rechazo, setRechazo] = useState<string | null>(null);
  const userId = user?.id ?? null;
  const [auditoriasPendientes, setAuditoriasPendientes] = useState(() => pendingAuditCount(userId));
  const [activeTool, setActiveTool] = useState<EditorTool>('SELECT');
  const [relationshipSourceId, setRelationshipSourceId] = useState<string | null>(null);
  const [classToRevealId, setClassToRevealId] = useState<string | null>(null);
  const [toolboxVisible, setToolboxVisible] = useState(true);
  const [panelVisible, setPanelVisible] = useState(true);

  // Las tres herramientas comparten un solo hueco. Apiladas no cabian: cada una
  // se quedaba con unos centimetros y todas con su propia barra de
  // desplazamiento, asi que ninguna se podia usar de verdad.
  const [herramienta, setHerramienta] = useState<Herramienta>('asistente');

  useEffect(() => {
    const updateCount = (): void => setAuditoriasPendientes(pendingAuditCount(userId));
    const cancelar = subscribeAuditQueue(updateCount);
    updateCount();
    const reintentar = (): void => void flushAuditQueue().catch(() => undefined);
    window.addEventListener('online', reintentar);
    reintentar();
    return () => {
      cancelar();
      window.removeEventListener('online', reintentar);
    };
  }, [userId]);

  const documento = useBoardDocument(board?.room ?? null, user, boardId, offline, board);
  const canWrite = documento.canWrite;

  const run = useCallback(
    (...commands: readonly CommandBody[]) => {
      if (user === null) return;

      const rechazado = documento.dispatch(makeBatch(user.id, ...commands));
      // RA-03: si el lote se rechaza no cambia nada, y hay que decir por que.
      setRechazo(
        rechazado === null || rechazado.length === 0
          ? null
          : (rechazado[0]?.message ?? 'El cambio no se pudo aplicar.'),
      );
    },
    [documento, user],
  );

  // Se depende de la funcion, que es estable, y no del objeto del documento, que
  // cambia con cada actualizacion del modelo.
  const { announceEditing } = documento;
  useEffect(() => {
    announceEditing(selectedId);
  }, [announceEditing, selectedId]);

  const chooseTool = useCallback((tool: EditorTool): void => {
    setActiveTool(tool);
    setRelationshipSourceId(null);
  }, []);

  const createClassAt = useCallback(
    (position: Position): void => {
      const classId = newId();
      setSelectedId(classId);
      setClassToRevealId(classId);
      run(gui.createClass(classId, 'Clase nueva', position));
      setActiveTool('SELECT');
    },
    [run],
  );

  const createRelationship = useCallback(
    (sourceClassId: string, targetClassId: string, kind: RelationshipKind): void => {
      if (sourceClassId === targetClassId && kind === 'GENERALIZATION') {
        setRechazo(
          'Una clase no puede heredar de si misma. Usa Asociación para crear una relación recursiva.',
        );
        setRelationshipSourceId(null);
        setActiveTool('SELECT');
        return;
      }
      const relationshipId = newId();
      run(gui.createRelationship(relationshipId, sourceClassId, targetClassId, kind));
      setSelectedId(relationshipId);
      setRelationshipSourceId(null);
      setActiveTool('SELECT');
    },
    [run],
  );

  const selectClassForTool = useCallback(
    (classId: string): void => {
      if (!isRelationshipTool(activeTool)) {
        setSelectedId(classId);
        return;
      }

      if (relationshipSourceId === null) {
        setRelationshipSourceId(classId);
        setSelectedId(classId);
        return;
      }

      createRelationship(relationshipSourceId, classId, relationshipKindFor(activeTool));
    },
    [activeTool, relationshipSourceId, createRelationship],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      // A modal owns keyboard interaction, including Escape and tool shortcuts.
      if (target?.closest('dialog[open], [data-tour-ui]')) return;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable === true
      ) {
        return;
      }

      if (event.key === 'Delete' && selectedId !== null && canWrite) {
        const esClase = documento.state.semantic.classes.some((item) => item.id === selectedId);
        const esRelacion = documento.state.semantic.relationships.some(
          (item) => item.id === selectedId,
        );
        if (!esClase && !esRelacion) return;

        event.preventDefault();
        run(esClase ? gui.deleteClass(selectedId) : gui.deleteRelationship(selectedId));
        setSelectedId(null);
        setRelationshipSourceId(null);
        return;
      }

      const toolByKey: Partial<Record<string, EditorTool>> = {
        v: 'SELECT',
        c: 'CLASS',
        '1': 'ASSOCIATION',
        '2': 'GENERALIZATION',
        '3': 'COMPOSITION',
        '4': 'AGGREGATION',
      };
      const tool = event.key === 'Escape' ? 'SELECT' : toolByKey[event.key.toLocaleLowerCase()];
      if (tool === undefined || (!canWrite && tool !== 'SELECT')) return;

      event.preventDefault();
      chooseTool(tool);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [canWrite, chooseTool, documento.state.semantic, run, selectedId]);

  useEffect(() => {
    if (
      relationshipSourceId !== null &&
      !documento.state.semantic.classes.some((item) => item.id === relationshipSourceId)
    ) {
      setRelationshipSourceId(null);
    }
  }, [documento.state.semantic.classes, relationshipSourceId]);

  // Una eliminacion remota puede dejar el inspector apuntando a un elemento
  // inexistente y la presencia anunciando que seguimos editandolo. La seleccion
  // es estado local de interfaz: se limpia en cuanto el documento confirma que
  // la clase o relacion ya no existe.
  useEffect(() => {
    // Una réplica recién creada está vacía y todavía no confirma nada: al
    // cambiar entre servidor y copia local no puede borrar la selección.
    if (
      selectedId === null ||
      (documento.state.semantic.classes.length === 0 && documento.status === 'conectando')
    )
      return;

    const sigueExistiendo =
      documento.state.semantic.classes.some((item) => item.id === selectedId) ||
      documento.state.semantic.relationships.some((item) => item.id === selectedId);
    if (!sigueExistiendo) setSelectedId(null);
  }, [
    documento.state.semantic.classes,
    documento.state.semantic.relationships,
    documento.status,
    selectedId,
    setSelectedId,
  ]);

  return (
    <div className="editor">
      <header className="barra-editor">
        <div className="identidad">
          {/* Proyecto › Pizarra. Antes solo habia una flecha sin nombre: dentro
              del editor no se sabia a donde llevaba, ni de que proyecto era la
              pizarra abierta. */}
          <nav className="miga" aria-label="Ubicación">
            <Link to={`/proyectos/${board.projectId}`} title="Volver al proyecto">
              Proyecto
            </Link>
            <span className="separador" aria-hidden="true">
              ›
            </span>
          </nav>
          <h1>{board.displayName}</h1>
        </div>

        <button
          type="button"
          className="principal"
          disabled={!canWrite}
          data-testid="crear-clase"
          title={canWrite ? 'Añadir una clase al diagrama' : 'Tu rol es de solo lectura'}
          onClick={() => {
            const classId = newId();
            setSelectedId(classId);
            setClassToRevealId(classId);
            // Se coloca escalonada para que las nuevas no se apilen encima.
            const total = documento.state.semantic.classes.length;
            run(
              gui.createClass(classId, 'Clase nueva', {
                x: 80 + (total % 4) * 300,
                y: 80 + Math.floor(total / 4) * 240,
              }),
            );
            chooseTool('SELECT');
          }}
        >
          Nueva clase
        </button>

        <div className="controles-vista" aria-label="Paneles del editor">
          <button
            type="button"
            className="fantasma boton-panel"
            aria-controls="editor-toolbox"
            aria-expanded={toolboxVisible}
            data-testid="alternar-toolbox"
            title={toolboxVisible ? 'Ocultar caja de herramientas' : 'Mostrar caja de herramientas'}
            onClick={() => setToolboxVisible((visible) => !visible)}
          >
            <span className="icono-panel icono-panel-izquierdo" aria-hidden="true" />
            Herramientas
          </button>
          <button
            type="button"
            className="fantasma boton-panel"
            aria-controls="panel-editor"
            aria-expanded={panelVisible}
            data-testid="alternar-panel"
            title={panelVisible ? 'Ocultar panel lateral' : 'Mostrar panel lateral'}
            onClick={() => setPanelVisible((visible) => !visible)}
          >
            <span className="icono-panel icono-panel-derecho" aria-hidden="true" />
            Propiedades
          </button>
        </div>

        <div className="separa" />
        <SoftwareGuide
          topic={
            herramienta === 'generar'
              ? 'generation'
              : herramienta === 'importar'
                ? 'import'
                : 'diagram'
          }
        />
        <ThemeSelect />

        <div className="estado-barra" role="status" aria-live="polite">
          <span className={`conexion ${documento.status}`} data-testid="estado-conexion">
            {ESTADO_CONEXION[documento.status]}
          </span>
          {shellReady && documento.offlineReady && !offline && (
            <span className="conexion" data-testid="offline-disponible">
              Disponible sin conexión
            </span>
          )}

          {auditoriasPendientes > 0 && (
            <span
              className="conexion desconectado"
              data-testid="auditoria-pendiente"
              title="Se volverá a intentar automáticamente al recuperar la conexión"
            >
              {auditoriasPendientes} cambio{auditoriasPendientes === 1 ? '' : 's'} por auditar
            </span>
          )}

          {!canWrite && (
            <span
              className="solo-lectura"
              data-testid="solo-lectura"
              title="Puedes ver y descargar, no editar"
            >
              Solo lectura
            </span>
          )}
        </div>

        <ul
          className="presencia"
          data-testid="presencia"
          aria-label={`${documento.participants.length} participante(s) en esta pizarra`}
        >
          {documento.participants.map((participante) => (
            <li
              key={participante.clientId}
              style={{ background: participante.color }}
              title={
                participante.editing === null
                  ? participante.displayName
                  : `${participante.displayName} está editando`
              }
            >
              <span aria-hidden="true">{participante.displayName.slice(0, 2).toUpperCase()}</span>
              <span className="visualmente-oculto">{participante.displayName}</span>
            </li>
          ))}
        </ul>

        {/* Cerrar sesion desde el editor: es donde se pasa el tiempo, y tener
            que volver a la lista de proyectos para salir invita a dejar la
            sesion abierta en una maquina compartida. */}
        <button type="button" className="salir" data-testid="salir" onClick={() => void logout()}>
          Salir
        </button>
      </header>

      {documento.status === 'rechazado' && (
        <p className="error banda">
          El servidor rechazó la conexión: {documento.rejection ?? 'sin motivo'}
        </p>
      )}
      {offline && (
        <p className="advertencia banda" role="status" data-testid="modo-offline">
          Estás trabajando con una copia local. Al volver la conexión se comprobarán tus permisos y
          se sincronizarán los cambios. El asistente y la generación requieren conexión.{' '}
          <Link to="/sin-conexion">Ver pizarras guardadas</Link>
        </p>
      )}
      {rechazo !== null && (
        <p className="error banda" data-testid="lote-rechazado">
          {rechazo}
        </p>
      )}
      {documento.accessNotice !== null && (
        <p className="advertencia banda" role="status" data-testid="aviso-permisos">
          {documento.accessNotice}
        </p>
      )}

      <div
        className={`lienzo${toolboxVisible ? '' : ' sin-toolbox'}${panelVisible ? '' : ' sin-panel'}`}
      >
        <div hidden={!toolboxVisible} className="contenedor-toolbox">
          <EditorToolbox
            activeTool={activeTool}
            relationshipSourceName={
              documento.state.semantic.classes.find((item) => item.id === relationshipSourceId)
                ?.displayName ?? null
            }
            canWrite={canWrite}
            onToolChange={chooseTool}
          />
        </div>

        <ReactFlowProvider>
          <BoardCanvas
            state={documento.state}
            issues={documento.issues}
            participants={documento.participants}
            selectedId={selectedId}
            revealClassId={classToRevealId}
            activeTool={activeTool}
            relationshipSourceId={relationshipSourceId}
            canWrite={canWrite}
            onSelect={setSelectedId}
            onClassClick={selectClassForTool}
            onCancelTool={() => chooseTool('SELECT')}
            onCreateClass={createClassAt}
            onMove={(classId, position, size) => run(gui.moveClass(classId, position, size))}
            onConnect={(origen, destino) =>
              createRelationship(
                origen,
                destino,
                isRelationshipTool(activeTool) ? relationshipKindFor(activeTool) : 'ASSOCIATION',
              )
            }
          />
        </ReactFlowProvider>

        <div id="panel-editor" className="paneles" hidden={!panelVisible}>
          <div className="pestanas-panel" role="tablist" aria-label="Herramientas auxiliares">
            {HERRAMIENTAS.map(([clave, etiqueta], indice) => (
              <button
                key={clave}
                id={`pestana-${clave}`}
                type="button"
                role="tab"
                aria-selected={herramienta === clave}
                aria-controls={`panel-${clave}`}
                tabIndex={herramienta === clave ? 0 : -1}
                className={herramienta === clave ? 'activa' : undefined}
                data-testid={`pestana-${clave}`}
                onClick={() => setHerramienta(clave)}
                onKeyDown={(event) => {
                  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                  event.preventDefault();
                  const ultimo = HERRAMIENTAS.length - 1;
                  const destino =
                    event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? ultimo
                        : event.key === 'ArrowRight'
                          ? (indice + 1) % HERRAMIENTAS.length
                          : (indice - 1 + HERRAMIENTAS.length) % HERRAMIENTAS.length;
                  const siguiente = HERRAMIENTAS[destino]?.[0];
                  if (siguiente === undefined) return;
                  setHerramienta(siguiente);
                  document.getElementById(`pestana-${siguiente}`)?.focus();
                }}
              >
                {etiqueta}
              </button>
            ))}
          </div>

          {/* Se ocultan con `hidden` en lugar de desmontarse: el asistente
              guarda la conversacion y la importacion el candidato en curso, y
              cambiar de pestana no puede tirarlos. */}
          <div className="herramienta">
            <div
              id="panel-asistente"
              role="tabpanel"
              aria-labelledby="pestana-asistente"
              hidden={herramienta !== 'asistente'}
            >
              <AssistantPanel
                boardId={board.id}
                state={documento.state}
                canWrite={canWrite}
                apply={documento.dispatch}
              />
            </div>
            <div
              id="panel-importar"
              role="tabpanel"
              aria-labelledby="pestana-importar"
              hidden={herramienta !== 'importar'}
            >
              <ImportPanel
                boardId={board.id}
                boardName={board.displayName}
                state={documento.state}
                canWrite={canWrite}
                apply={documento.dispatch}
              />
            </div>
            <div
              id="panel-generar"
              role="tabpanel"
              aria-labelledby="pestana-generar"
              hidden={herramienta !== 'generar'}
            >
              <GenerationPanel boardId={board.id} issues={documento.issues} canWrite={canWrite} />
            </div>
          </div>

          <Inspector
            state={documento.state}
            selectedId={selectedId}
            canWrite={canWrite}
            run={run}
            onSelect={setSelectedId}
          />
          <ValidationPanel issues={documento.issues} onSelect={setSelectedId} />
        </div>
      </div>

      <footer className="barra-estado">
        <span className="dato">{documento.state.semantic.classes.length} clases</span>
        <span className="dato">{documento.state.semantic.relationships.length} relaciones</span>

        <span className="separa" />

        {/* El mismo criterio que el panel de validacion, en el sitio donde se
            mira sin pensar: los errores bloquean generar, no editar. */}
        <span
          className={`dato ${hasErrors(documento.issues) ? 'bloqueado' : 'listo'}`}
          data-testid="puede-generar"
        >
          {hasErrors(documento.issues) ? 'Generación bloqueada' : 'Generación disponible'}
        </span>
      </footer>
    </div>
  );
}
