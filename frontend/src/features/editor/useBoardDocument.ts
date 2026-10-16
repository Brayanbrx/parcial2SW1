import { HocuspocusProvider } from '@hocuspocus/provider';
import {
  emptyBoardState,
  type BoardState,
  type CommandBatch,
  type SemanticModel,
  type ValidationIssue,
} from '@uml/contracts';
import { validateModel, validateProposalPreconditions } from '@uml/domain-core';
import { readBoardState } from '@uml/yjs-adapter';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as Y from 'yjs';
import {
  api,
  currentAccessToken,
  refreshSession,
  sessionRefreshUnavailable,
} from '../../lib/api.js';
import { useSession } from '../auth/session.js';
import { BoardDrafts } from './board-drafts.js';
import {
  downgradeBoard,
  forgetBoard,
  rememberBoard,
  type OfflineBoard,
} from '../../lib/offline.js';

/**
 * Enlaza React con el documento colaborativo.
 *
 * El modelo **no** se guarda en el estado de la interfaz: vive en el documento y
 * lo que React mantiene es una proyeccion que se recalcula en cada actualizacion.
 * Guardarlo en Zustand crearia una segunda copia que habria que mantener
 * sincronizada a mano, y el editor visual siempre es una proyeccion del
 * documento, nunca la fuente de verdad (plan maestro 4.5).
 */

export type ConnectionStatus = 'conectando' | 'conectado' | 'desconectado' | 'rechazado';

export interface Participant {
  readonly clientId: number;
  readonly displayName: string;
  readonly color: string;
  /** Identificador del elemento que esta editando, si lo hay. */
  readonly editing: string | null;
}

export interface BoardDocument {
  readonly state: BoardState;
  readonly issues: readonly ValidationIssue[];
  readonly status: ConnectionStatus;
  readonly rejection: string | null;
  readonly accessNotice: string | null;
  readonly participants: readonly Participant[];
  readonly canWrite: boolean;
  readonly offlineReady: boolean;
  /** Aplica un lote. Devuelve los hallazgos si se rechaza. */
  dispatch(
    batch: CommandBatch,
    expected?: SemanticModel,
    scope?: 'AFFECTED' | 'MODEL',
  ): readonly ValidationIssue[] | null;
  /** Anuncia que elemento se esta editando, para la presencia. */
  announceEditing(elementId: string | null): void;
}

const COLORES = [
  '#2563eb',
  '#16a34a',
  '#db2777',
  '#ea580c',
  '#7c3aed',
  '#0891b2',
  '#ca8a04',
  '#dc2626',
];

function colorPara(clientId: number): string {
  return COLORES[Math.abs(clientId) % COLORES.length] as string;
}

/** Sin cambios durante este tiempo, la copia para abrir sin conexion se reescribe. */
const ESPERA_INSTANTANEA = 1000;

export function useBoardDocument(
  room: string | null,
  me: { id: string; displayName: string } | null,
  /**
   * Pizarra a la que atribuir los lotes aplicados (RF-A09).
   *
   * Va aparte de `room` porque el registro es HTTP y la sala es del canal de
   * tiempo real: CA-023.1 dice que el protocolo colaborativo transporta
   * actualizaciones del documento, no comandos, y que los comandos se registran
   * para auditoria y no para sincronizar.
   */
  boardId: string | null = null,
  offline = false,
  board: OfflineBoard | null = null,
): BoardDocument {
  const { activateOfflineCopy } = useSession();
  const [doc, setDoc] = useState(() => new Y.Doc());
  const [canWrite, setCanWrite] = useState(false);
  const [offlineReady, setOfflineReady] = useState(false);
  const writeAllowed = useRef(false);
  const [accessNotice, setAccessNotice] = useState<string | null>(null);
  const [state, setState] = useState<BoardState>(() => emptyBoardState());
  const [status, setStatus] = useState<ConnectionStatus>('conectando');
  const [rejection, setRejection] = useState<string | null>(null);
  const [participants, setParticipants] = useState<readonly Participant[]>([]);
  const providerRef = useRef<HocuspocusProvider | null>(null);
  const draftsRef = useRef<BoardDrafts | null>(null);
  const userId = me?.id;
  // Una ranura por editor, no por reintento de conexión: volver a consultar la
  // sesión o los metadatos no debe acumular otra copia completa por edición.
  const drafts = useMemo(() => {
    if (userId === undefined || room === null) return null;
    try {
      return new BoardDrafts(window.localStorage, userId, room);
    } catch {
      return null;
    }
  }, [userId, room]);

  /**
   * Cada modo trabaja sobre su propia replica.
   *
   * Al reconectar no se puede enchufar al proveedor la replica que estuvo sin
   * red: los borradores se mezclan despues, y solo tras confirmar escritura. Y
   * al perder la red hay que partir del estado autorizado en disco.
   *
   * El cambio se hace aqui, ajustando el estado durante el render, y no
   * remontando el editor desde la ruta: `BoardSession` guarda la conversacion
   * del asistente y el candidato de importacion en curso — trabajo que puede
   * haber costado una llamada de IA — y un corte de red no puede tirarlos.
   * React vuelve a renderizar antes de confirmar, asi que el efecto se ejecuta
   * una sola vez, ya con el documento nuevo.
   */
  const [replicaMode, setReplicaMode] = useState(offline);
  if (replicaMode !== offline) {
    setReplicaMode(offline);
    setDoc(new Y.Doc());
    setState(emptyBoardState());
    writeAllowed.current = false;
    setCanWrite(false);
    // `conectando` describe exactamente este instante: hay una replica vacia que
    // todavia no dice nada del modelo. Quien observa la proyeccion lo necesita
    // para no confundirla con un diagrama al que le borraron todo.
    setStatus('conectando');
    setOfflineReady(false);
  }

  useEffect(() => {
    if (room === null || me === null) return;

    setStatus(navigator.onLine ? 'conectando' : 'desconectado');
    setRejection(null);
    setParticipants([]);
    draftsRef.current = drafts;
    if (drafts === null) {
      setAccessNotice('El almacenamiento local no está disponible. No se podrán guardar cambios.');
    }

    if (offline) {
      setStatus('desconectado');
      try {
        const writable = board !== null && board.role !== 'VIEWER';
        if (!draftsRef.current?.openOffline(doc, writable)) throw new Error('No hay copia local');
        writeAllowed.current = writable;
        setCanWrite(writable);
        setOfflineReady(true);
        setState(readBoardState(doc));
      } catch {
        writeAllowed.current = false;
        setCanWrite(false);
        setAccessNotice(
          'No se pudo abrir la copia local. Vuelve a conectarte para recuperar la pizarra.',
        );
      }
      const update = (): void => setState(readBoardState(doc));
      doc.on('update', update);
      return () => {
        doc.off('update', update);
        draftsRef.current = null;
      };
    }

    const token = currentAccessToken();
    if (token === null) {
      setStatus('rechazado');
      setRejection('No hay sesion.');
      return;
    }

    const provider = new HocuspocusProvider({
      // Un solo origen: el proxy enruta `/collab` al proceso de colaboracion.
      url: `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/collab`,
      name: room,
      // El proveedor vuelve a pedir el valor en cada reconexion. Una cadena
      // fija quedaria obsoleta si mientras tanto la API renueva la sesion.
      token: () => currentAccessToken() ?? '',
      document: doc,
    });
    providerRef.current = provider;

    let disposed = false;
    let draftsRestored = false;
    let serverSynced = false;
    const restoreDrafts = (): void => {
      if (
        disposed ||
        !serverSynced ||
        draftsRestored ||
        !writeAllowed.current ||
        draftsRef.current === null
      )
        return;
      // Set before applying: applying the update can synchronously emit synced.
      draftsRestored = true;
      try {
        if (draftsRef.current.restore(doc)) {
          setAccessNotice('Se recuperó la copia local de esta pizarra y se enviará al servidor.');
        }
      } catch {
        writeAllowed.current = false;
        setCanWrite(false);
        setAccessNotice(
          'No se pudo recuperar la copia local. Se conserva intacta; libera espacio o revisa el almacenamiento antes de editar.',
        );
      }
    };
    let snapshotTimer: number | undefined;
    const saveSnapshot = (): void => {
      if (snapshotTimer !== undefined) {
        window.clearTimeout(snapshotTimer);
        snapshotTimer = undefined;
      }
      if (!serverSynced || !provider.isAuthenticated || board === null) return;
      try {
        if (draftsRef.current === null) return;
        draftsRef.current.snapshot(doc);
        rememberBoard(me.id, {
          ...board,
          role: writeAllowed.current ? (board.role === 'OWNER' ? 'OWNER' : 'EDITOR') : 'VIEWER',
        });
        setOfflineReady(true);
      } catch {
        setOfflineReady(false);
        setAccessNotice(
          'No se pudo actualizar la copia para abrir sin conexión. Revisa el espacio del navegador.',
        );
      }
    };
    /**
     * Guardar en cada actualizacion del documento codificaba el modelo completo
     * y lo escribia en `localStorage` de forma sincrona por cada pulsacion de
     * cualquier participante. Se agrupa: la copia solo tiene que estar al dia
     * cuando la pestana deja de recibir cambios, se oculta o se cierra.
     */
    const scheduleSnapshot = (): void => {
      if (snapshotTimer !== undefined || !serverSynced || board === null) return;
      snapshotTimer = window.setTimeout(() => {
        snapshotTimer = undefined;
        saveSnapshot();
      }, ESPERA_INSTANTANEA);
    };
    const flushSnapshot = (): void => {
      if (snapshotTimer !== undefined) saveSnapshot();
    };
    // `pagehide` tambien cubre cerrar la pestana; `visibilitychange` el paso a
    // segundo plano, que en movil es lo ultimo que se ejecuta con garantias.
    window.addEventListener('pagehide', flushSnapshot);
    document.addEventListener('visibilitychange', flushSnapshot);
    let lastPermissionWasWrite = writeAllowed.current;
    const permissions = (readOnly: boolean): void => {
      if (disposed) return;
      const lostWriteAccess = lastPermissionWasWrite && readOnly;
      lastPermissionWasWrite = !readOnly;
      writeAllowed.current = !readOnly;
      setCanWrite(!readOnly);
      // También al autenticar una réplica nueva: el rol de la caché puede venir
      // de una sesión anterior, y no puede esperar a la sincronización.
      if (readOnly && boardId !== null) downgradeBoard(me.id, boardId);
      if (lostWriteAccess) {
        serverSynced = false;
        setOfflineReady(false);
        // La entrada no se retira: la copia sigue siendo la del servidor y su
        // apertura sin red sigue autorizada, pero solo como lectura. Degradarla
        // ahora evita que un corte inmediato permita editar lo que ya no se
        // puede publicar, sin esperar a que termine la resincronizacion.
        setAccessNotice(
          'Tu permiso cambió a solo lectura. Se recargó la pizarra desde el servidor; la copia local se conserva y no se enviará sin permiso de edición.',
        );
        setStatus('conectando');
        provider.disconnect();
        // Mezclar el estado remoto con este Y.Doc volvería a introducir las
        // operaciones rechazadas. Una réplica limpia elimina los cambios fantasma.
        setState(emptyBoardState());
        setDoc(new Y.Doc());
      } else {
        restoreDrafts();
        saveSnapshot();
      }
    };
    provider.on('authenticated', ({ scope }: { scope: string }) =>
      permissions(scope !== 'read-write'),
    );
    provider.on('stateless', ({ payload }: { payload: string }) => {
      try {
        const message: unknown = JSON.parse(payload);
        if (
          typeof message === 'object' &&
          message !== null &&
          'type' in message &&
          message.type === 'access-changed' &&
          'readOnly' in message &&
          typeof message.readOnly === 'boolean'
        ) {
          permissions(message.readOnly);
        }
      } catch {
        /* Otros mensajes stateless no cambian permisos. */
      }
    });
    // También detecta cambios cuando todos los participantes están inactivos.
    const checkAccess = (): void => {
      if (provider.isAuthenticated) provider.sendStateless('check-access');
    };
    const accessTimer = window.setInterval(checkAccess, 5000);
    window.addEventListener('focus', checkAccess);

    let accesoRechazado = false;
    provider.on('synced', () => {
      if (disposed) return;
      serverSynced = true;
      restoreDrafts();
      accesoRechazado = false;
      setStatus('conectado');
      saveSnapshot();
    });
    provider.on('disconnect', () =>
      setStatus((previo) => (previo === 'rechazado' ? previo : 'desconectado')),
    );
    let renovandoToken = false;
    const rejectAccess = ({ reason }: { reason: string }): void => {
      if (disposed) return;
      writeAllowed.current = false;
      setCanWrite(false);
      serverSynced = false;
      // Un token de acceso vencido no es una revocacion: el proceso de
      // colaboracion cierra por ese motivo cada vez que expira (cada quince
      // minutos con una pizarra abierta). Borrar la entrada aqui dejaba la
      // pizarra inabrible sin red si la renovacion no llegaba a completarse,
      // aunque la instantanea siguiera intacta en el navegador.
      if (reason !== 'token-invalido') {
        setOfflineReady(false);
        if (boardId !== null) forgetBoard(me.id, boardId);
      }
      provider.disconnect();
      if (reason === 'token-invalido' && !renovandoToken) {
        renovandoToken = true;
        void refreshSession().then((renovado) => {
          if (disposed) return;
          renovandoToken = false;
          if (renovado) {
            accesoRechazado = false;
            setStatus('conectando');
            setRejection(null);
            provider.connect();
            return;
          }
          if (sessionRefreshUnavailable()) {
            setStatus('desconectado');
            setRejection(null);
            // El proveedor de sesión reintenta mientras se usa la copia local;
            // también cuando navigator.onLine sigue siendo true.
            activateOfflineCopy();
            return;
          }
          accesoRechazado = true;
          writeAllowed.current = false;
          setCanWrite(false);
          setStatus('rechazado');
          setRejection('La sesión expiró. Inicia sesión nuevamente.');
        });
        return;
      }

      accesoRechazado = true;
      writeAllowed.current = false;
      setCanWrite(false);
      setStatus('rechazado');
      setRejection(reason);
      provider.disconnect();
    };
    provider.on('authenticationFailed', rejectAccess);
    // Hocuspocus puede cerrar solo la sala manteniendo abierto el WebSocket.
    // Ese cierre emite `close`, no `authenticationFailed` ni `disconnect`.
    provider.on('close', ({ event }: { event: { reason?: string } }) => {
      if (event.reason === 'sin-acceso-a-la-pizarra' || event.reason === 'token-invalido') {
        rejectAccess({ reason: event.reason });
      }
    });

    provider.setAwarenessField('user', {
      displayName: me.displayName,
      color: colorPara(provider.document.clientID),
    });

    const leerPresencia = (): void => {
      const estados = provider.awareness?.getStates() ?? new Map<number, unknown>();
      const lista: Participant[] = [];

      for (const [clientId, valor] of estados) {
        const usuario = (valor as { user?: { displayName?: string; color?: string } }).user;
        if (usuario?.displayName === undefined) continue;

        lista.push({
          clientId,
          displayName: usuario.displayName,
          color: usuario.color ?? colorPara(clientId),
          editing: (valor as { editing?: string | null }).editing ?? null,
        });
      }

      lista.sort((izq, der) => izq.clientId - der.clientId);

      // Solo se actualiza si de verdad cambio. La presencia se emite en cada
      // latido, y un array nuevo en cada uno provocaria un render por latido.
      setParticipants((previo) => (mismaPresencia(previo, lista) ? previo : lista));
    };

    provider.on('awarenessUpdate', leerPresencia);
    provider.on('awarenessChange', leerPresencia);

    // `disconnect` puede tardar hasta que el socket detecta que la red murio.
    // El navegador ya conoce ese estado y debe reflejarse de inmediato: dejar
    // «En vivo» mientras se trabaja sin conexion hace creer que los demas ya
    // recibieron cambios que todavia solo existen en esta replica.
    const alQuedarSinRed = (): void => {
      // El navegador lo sabe antes que el socket, asi que la conexion todavia
      // esta autenticada: es el ultimo momento en que se puede guardar lo que
      // quedara pendiente del agrupado.
      flushSnapshot();
      setStatus((previo) => (previo === 'rechazado' ? previo : 'desconectado'));
      provider.disconnect();
    };
    const alVolverLaRed = (): void => {
      if (accesoRechazado) return;
      setStatus('conectando');
      provider.connect();
    };
    window.addEventListener('offline', alQuedarSinRed);
    window.addEventListener('online', alVolverLaRed);

    if (!navigator.onLine) provider.disconnect();

    const alActualizar = (): void => {
      setState(readBoardState(doc));
      scheduleSnapshot();
    };
    doc.on('update', alActualizar);
    alActualizar();
    leerPresencia();

    return () => {
      disposed = true;
      window.clearInterval(accessTimer);
      window.removeEventListener('focus', checkAccess);
      doc.off('update', alActualizar);
      window.removeEventListener('offline', alQuedarSinRed);
      window.removeEventListener('online', alVolverLaRed);
      window.removeEventListener('pagehide', flushSnapshot);
      document.removeEventListener('visibilitychange', flushSnapshot);
      // Antes de destruir el proveedor: `saveSnapshot` exige que la conexion
      // siga autenticada para no guardar un estado que el servidor no confirmo.
      flushSnapshot();
      provider.destroy();
      providerRef.current = null;
      draftsRef.current = null;
    };
  }, [doc, room, me, offline, board, boardId, activateOfflineCopy, drafts]);

  // La validacion se recalcula solo cuando cambia el modelo. El layout cambia en
  // cada arrastre y no afecta a la validez.
  const issues = useMemo(() => validateModel(state.semantic), [state.semantic]);

  const dispatch = useMemo(
    () =>
      (
        batch: CommandBatch,
        expected?: SemanticModel,
        scope: 'AFFECTED' | 'MODEL' = 'AFFECTED',
      ): readonly ValidationIssue[] | null => {
        if (!writeAllowed.current)
          return [
            {
              code: 'WRITE_ACCESS_DENIED',
              severity: 'ERROR',
              elementIds: [],
              message: 'Ya no tienes permiso para editar esta pizarra.',
            },
          ];
        if (expected !== undefined) {
          const conflicts = validateProposalPreconditions(
            batch,
            expected,
            readBoardState(doc).semantic,
            scope,
          );
          if (conflicts.length > 0) return conflicts;
        }

        const batchAplicado = conPosiciones(doc, batch);
        let resultado;
        try {
          if (draftsRef.current === null) throw new Error('Sin almacenamiento local');
          resultado = draftsRef.current.apply(doc, batchAplicado);
        } catch {
          return [
            {
              code: 'WRITE_ACCESS_DENIED',
              severity: 'ERROR',
              elementIds: [],
              message:
                'No se pudo guardar la copia local. El cambio no se aplicó. Libera espacio o habilita el almacenamiento del navegador y reintenta.',
            },
          ];
        }
        if (!resultado.applied) return resultado.issues;

        // Se registra despues de aplicar y sin esperar la respuesta: el cambio ya
        // esta en el documento y en las demas pantallas, asi que un fallo del
        // registro no puede deshacerlo. Se avisa por consola y se sigue — perder
        // una linea de auditoria es malo, congelar el editor por ella es peor.
        if (boardId !== null) {
          // Se registra el lote materializado, incluida la posicion que esta
          // capa asigna a clases importadas o propuestas por el asistente. Asi
          // la auditoria describe exactamente el cambio que recibio Yjs.
          void api.recordBatch(boardId, batchAplicado).catch((causa: unknown) => {
            console.warn('No se pudo registrar el lote para auditoria', causa);
          });
        }

        // La proyeccion se refresca por el evento `update`, pero se adelanta aqui
        // para que la interfaz no espere un ciclo de eventos tras cada accion.
        setState(readBoardState(doc));
        return null;
      },
    [doc, canWrite, boardId],
  );

  const announceEditing = useMemo(
    () =>
      (elementId: string | null): void => {
        providerRef.current?.setAwarenessField('editing', elementId);
      },
    [],
  );

  // El objeto se memoiza: devolverlo nuevo en cada render haria que cualquier
  // efecto que dependa de el se dispare siempre, y `announceEditing` provocaria
  // una actualizacion de presencia por render — un bucle sin fondo.
  return useMemo(
    () => ({
      state,
      issues,
      status,
      rejection,
      accessNotice,
      participants,
      canWrite,
      offlineReady,
      dispatch,
      announceEditing,
    }),
    [
      state,
      issues,
      status,
      rejection,
      accessNotice,
      participants,
      canWrite,
      offlineReady,
      dispatch,
      announceEditing,
    ],
  );
}

function mismaPresencia(izq: readonly Participant[], der: readonly Participant[]): boolean {
  if (izq.length !== der.length) return false;

  return izq.every((participante, indice) => {
    const otro = der[indice];
    return (
      otro !== undefined &&
      participante.clientId === otro.clientId &&
      participante.displayName === otro.displayName &&
      participante.editing === otro.editing
    );
  });
}

/**
 * Coloca en rejilla las clases que llegan sin posicion.
 *
 * El modelo canonico no lleva posiciones: viven en la capa de disposicion. El
 * boton «Nueva clase» ya calculaba una, pero el asistente y las importaciones
 * no, asi que **todo lo que crean caia en (0, 0)**: importar un diagrama de
 * cinco clases las dejaba una encima de otra, y encima de las que ya estaban.
 *
 * Se resuelve aqui, en el unico punto por el que pasan todos los lotes, y no en
 * cada panel. La posicion viaja dentro del comando, asi que los demas
 * participantes ven la misma disposicion en lugar de calcular cada uno la suya.
 */
function conPosiciones(doc: Y.Doc, batch: CommandBatch): CommandBatch {
  const nuevas = batch.commands.filter(
    (comando) => comando.type === 'CREATE_CLASS' && comando.payload.position === undefined,
  );
  if (nuevas.length === 0) return batch;

  let ocupadas = readBoardState(doc).semantic.classes.length;

  return {
    ...batch,
    commands: batch.commands.map((comando) => {
      if (comando.type !== 'CREATE_CLASS' || comando.payload.position !== undefined) {
        return comando;
      }

      const posicion = {
        x: 80 + (ocupadas % 4) * 300,
        y: 80 + Math.floor(ocupadas / 4) * 240,
      };
      ocupadas += 1;

      return { ...comando, payload: { ...comando.payload, position: posicion } };
    }),
  };
}
