import {
  appendClarification,
  clarificationText,
  contextToDraft,
  exceedsContext,
} from './conversation-context.js';
import type { BoardState, CommandBatch, SemanticModel, ValidationIssue } from '@uml/contracts';
import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../../lib/api.js';
import { useSpeech } from './useSpeech.js';
import { prepareDictation } from './prepare-dictation.js';
import { AssistantLearningGuide } from './AssistantLearningGuide.js';

/**
 * Asistente por texto y voz (RF-030 a RF-037).
 *
 * El servidor resuelve la instruccion y devuelve un lote; **este panel lo
 * aplica por el mismo camino que la interfaz grafica**. El asistente es otro
 * adaptador que produce comandos, no una via paralela.
 *
 * Nada se aplica sin que el usuario lo vea: lo que llega se muestra como
 * propuesta con su resumen, y hay un boton para aceptarla.
 */

type Outcome =
  | { kind: 'BATCH'; batch: CommandBatch; summary: string[]; rationale: string | null }
  | {
      kind: 'CONFIRMATION';
      batch: CommandBatch;
      summary: string[];
      question: string;
      rationale: string | null;
    }
  | { kind: 'QUESTION'; question: string; options?: string[]; rationale: string | null }
  | { kind: 'REJECTED'; issues: ValidationIssue[]; rationale: string | null };

type Entrada =
  | { rol: 'usuario'; texto: string }
  | { rol: 'asistente'; texto: string }
  | {
      rol: 'propuesta';
      outcome: Extract<Outcome, { kind: 'BATCH' | 'CONFIRMATION' }>;
      aplicada: boolean;
      obsolete: boolean;
      expected: SemanticModel;
      instruction: string;
      context: readonly TurnoDeContexto[];
    };

type TurnoDeContexto = { readonly role: 'user' | 'assistant'; readonly text: string };

export interface AssistantPanelProps {
  readonly boardId: string;
  readonly state: BoardState;
  readonly canWrite: boolean;
  /** Aplica el lote por el mismo camino que la interfaz. */
  apply(batch: CommandBatch, expected?: SemanticModel): readonly ValidationIssue[] | null;
}

export function AssistantPanel({
  boardId,
  state,
  canWrite,
  apply,
}: AssistantPanelProps): React.JSX.Element {
  const [historial, setHistorial] = useState<readonly Entrada[]>([]);
  const [texto, setTexto] = useState('');
  const [pendiente, setPendiente] = useState(false);
  const [modo, setModo] = useState<'instruir' | 'preguntar'>('instruir');
  const [contexto, setContexto] = useState<readonly TurnoDeContexto[]>([]);
  const [dictadoOriginal, setDictadoOriginal] = useState<string | null>(null);
  const antesDelDictado = useRef('');
  const enviando = useRef(false);
  const revision = useRef(0);
  const solicitud = useRef<{ controller: AbortController; instruction: string } | null>(null);
  const entrada = useRef<HTMLTextAreaElement>(null);
  const voz = useSpeech((transcrito) => {
    if (transcrito.trim() === '') {
      setTexto(antesDelDictado.current);
      setDictadoOriginal(null);
      return;
    }
    const original = [antesDelDictado.current, transcrito].filter(Boolean).join(' ');
    setDictadoOriginal(original);
    setTexto(prepareDictation(original));
  });
  const contextoLleno = modo === 'instruir' && exceedsContext(contexto);
  const dictando = voz.listening || voz.stopping;
  const visible = dictando
    ? [antesDelDictado.current, voz.transcript].filter(Boolean).join(' ')
    : texto;

  useEffect(() => {
    if (dictando && entrada.current) entrada.current.scrollTop = entrada.current.scrollHeight;
  }, [visible, dictando]);

  /**
   * La conversacion crece hacia abajo y no se movia sola.
   *
   * A la tercera o cuarta instruccion, la propuesta nueva —con su boton de
   * aplicar— aparecia fuera de la vista: la persona escribe, parece que no pasa
   * nada, y vuelve a escribir. `block: 'nearest'` desplaza lo justo, y recorre
   * todos los contenedores con desplazamiento, no solo el mas cercano: aqui hay
   * dos anidados y cual de los dos se mueve depende del alto disponible.
   */
  const finDeConversacion = useRef<HTMLLIElement>(null);

  useEffect(() => {
    // Al montar el panel vacío no hay un mensaje que revelar. Desplazar su
    // ancla entonces ocultaba la cabecera del editor en pantallas pequeñas.
    if (historial.length > 0) finDeConversacion.current?.scrollIntoView({ block: 'nearest' });
  }, [historial]);

  useEffect(() => {
    // Una aclaracion pertenece a una pizarra concreta. Si la navegacion cambia
    // el `boardId` sin desmontar el panel, no debe filtrarse al nuevo modelo.
    setHistorial([]);
    setContexto([]);
    setTexto('');
    setDictadoOriginal(null);
    setPendiente(false);
    enviando.current = false;
    voz.cancel();
    revision.current++;
    return () => {
      revision.current++;
      solicitud.current?.controller.abort();
      solicitud.current = null;
    };
  }, [boardId, voz.cancel]);

  async function enviar(entrada: string): Promise<void> {
    const limpio = entrada.trim();
    if (
      contextoLleno ||
      limpio === '' ||
      limpio.length > 2000 ||
      enviando.current ||
      dictando ||
      (modo === 'instruir' && !canWrite)
    )
      return;
    enviando.current = true;
    const actual = revision.current;
    const controller = new AbortController();
    solicitud.current = { controller, instruction: limpio };

    setHistorial((previo) => [...previo, { rol: 'usuario', texto: limpio }]);
    setTexto('');
    setDictadoOriginal(null);
    setPendiente(true);

    try {
      if (modo === 'preguntar') {
        const respuesta = await apiRequest<{ answer: string }>(
          `/boards/${boardId}/assistant/question`,
          {
            method: 'POST',
            body: { question: limpio, model: state.semantic },
            signal: controller.signal,
          },
        );
        if (actual !== revision.current) return;
        setHistorial((previo) => [...previo, { rol: 'asistente', texto: respuesta.answer }]);
        return;
      }

      const outcome = await apiRequest<Outcome>(`/boards/${boardId}/assistant/instruction`, {
        method: 'POST',
        body: { instruction: limpio, context: contexto, model: state.semantic },
        signal: controller.signal,
      });

      if (actual !== revision.current) return;
      setHistorial((previo) => [...previo, entradaDe(outcome, state.semantic, limpio, contexto)]);

      if (outcome.kind === 'QUESTION') {
        // La pregunta del asistente y la respuesta siguiente forman una sola
        // solicitud. Conservar ambas evita que una aclaracion como «id es int»
        // haga desaparecer las clases y atributos pedidos en el primer turno.
        setContexto((previo) =>
          appendClarification(previo, limpio, outcome.question, outcome.options),
        );
      } else {
        // La solicitud ya produjo una propuesta o un rechazo definitivo. El
        // turno siguiente debe comenzar limpio para no repetir operaciones.
        setContexto([]);
      }
    } catch (error) {
      if (actual !== revision.current) return;
      setTexto(limpio);
      setHistorial((previo) => [
        ...previo,
        { rol: 'asistente', texto: error instanceof Error ? error.message : 'Algo salio mal.' },
      ]);
    } finally {
      if (actual === revision.current) {
        solicitud.current = null;
        enviando.current = false;
        setPendiente(false);
      }
    }
  }

  function cancelarSolicitud(): void {
    const active = solicitud.current;
    if (!active) return;
    revision.current++;
    solicitud.current = null;
    active.controller.abort();
    enviando.current = false;
    setPendiente(false);
    setTexto(active.instruction);
    setHistorial((previo) => [
      ...previo,
      {
        rol: 'asistente',
        texto: 'Solicitud cancelada. Puedes revisar el texto y volver a enviarlo.',
      },
    ]);
  }

  function aplicar(indice: number, batch: CommandBatch): void {
    const propuesta = historial[indice];
    if (propuesta?.rol !== 'propuesta' || propuesta.obsolete || propuesta.aplicada) return;
    const rechazo = apply(batch, propuesta.expected);
    const obsolete = rechazo?.some((issue) => issue.code === 'STALE_PROPOSAL') ?? false;
    if (obsolete) {
      setTexto(propuesta.instruction);
      setContexto(propuesta.context);
    }

    setHistorial((previo) =>
      previo.map((entrada, posicion) => {
        if (posicion !== indice || entrada.rol !== 'propuesta') return entrada;
        return { ...entrada, aplicada: rechazo === null, obsolete };
      }),
    );

    if (rechazo !== null && rechazo.length > 0) {
      setHistorial((previo) => [
        ...previo,
        {
          rol: 'asistente',
          texto: `No se pudo aplicar: ${rechazo[0]?.message ?? 'el lote fue rechazado.'}`,
        },
      ]);
    }
  }

  return (
    <section className="asistente" data-testid="asistente">
      <header>
        <div className="pestanas">
          <button
            type="button"
            className={modo === 'instruir' ? 'activa' : ''}
            data-testid="modo-instruir"
            disabled={pendiente || dictando}
            onClick={() => setModo('instruir')}
          >
            Instruir
          </button>
          <button
            type="button"
            className={modo === 'preguntar' ? 'activa' : ''}
            data-testid="modo-preguntar"
            disabled={pendiente || dictando}
            onClick={() => setModo('preguntar')}
          >
            Consultar
          </button>
        </div>
      </header>

      <div className="asistente-aprendizaje">
        <AssistantLearningGuide
          key={boardId}
          model={state.semantic}
          canWrite={canWrite}
          canUseExample={!pendiente && !dictando && texto.trim() === '' && contexto.length === 0}
          useExample={(nextMode, example) => {
            setModo(nextMode);
            setTexto(example);
            setDictadoOriginal(null);
            entrada.current?.focus();
          }}
        />
      </div>

      <ol className="conversacion" data-testid="conversacion">
        {historial.length === 0 && (
          <li className="pista">
            {modo === 'instruir'
              ? 'Por ejemplo: «agrega telefono tipo String a Cliente».'
              : 'Por ejemplo: «¿puedo generar el backend?».'}
          </li>
        )}

        {historial.map((entrada, indice) => (
          <li key={indice} className={entrada.rol}>
            {entrada.rol !== 'propuesta' && <p>{entrada.texto}</p>}

            {entrada.rol === 'propuesta' && (
              <div className="propuesta" data-testid="propuesta">
                {entrada.outcome.kind === 'CONFIRMATION' && (
                  <p className="advertencia" data-testid="confirmacion">
                    {entrada.outcome.question}
                  </p>
                )}

                {entrada.outcome.rationale && <p>{entrada.outcome.rationale}</p>}
                <ul className="resumen">
                  {entrada.outcome.summary.map((linea, posicion) => (
                    <li key={posicion}>{linea}</li>
                  ))}
                </ul>

                {entrada.aplicada ? (
                  <p className="aplicada">Aplicado.</p>
                ) : entrada.obsolete ? (
                  <p className="advertencia" data-testid="propuesta-obsoleta">
                    Propuesta desactualizada. La instrucción se recuperó en el cuadro de texto para
                    que puedas enviarla y revisarla de nuevo.
                  </p>
                ) : (
                  <button
                    type="button"
                    className="principal"
                    disabled={!canWrite || pendiente || dictando}
                    data-testid="aplicar-propuesta"
                    onClick={() => aplicar(indice, entrada.outcome.batch)}
                  >
                    {entrada.outcome.kind === 'CONFIRMATION' ? 'Sí, aplicar' : 'Aplicar'}
                  </button>
                )}
              </div>
            )}
          </li>
        ))}

        {/* Ancla del desplazamiento automatico. Va dentro de la lista para que
            quede debajo de lo ultimo que se anadio. */}
        <li ref={finDeConversacion} className="ancla-conversacion" aria-hidden="true" />
      </ol>

      {contexto.length > 0 && (
        <div className="contexto-asistente" data-testid="contexto-asistente" role="status">
          <span>
            {contextoLleno
              ? 'Hay muchas aclaraciones pendientes. Revisa la solicitud completa antes de continuar.'
              : 'Aclaración en curso: recordaré la solicitud anterior en tu próximo mensaje.'}
          </span>
          {contextoLleno && (
            <button
              type="button"
              disabled={pendiente || dictando}
              data-testid="revisar-contexto"
              onClick={() => {
                setTexto(contextToDraft(contexto, texto));
                setContexto([]);
                setDictadoOriginal(null);
              }}
            >
              Revisar solicitud completa
            </button>
          )}
          <button
            type="button"
            disabled={pendiente}
            data-testid="descartar-contexto"
            onClick={() => setContexto([])}
          >
            Empezar de nuevo
          </button>
        </div>
      )}

      {voz.error !== null && <p className="error">{voz.error}</p>}
      {dictando && (
        <p role="status" className="estado-dictado">
          {voz.stopping
            ? 'Finalizando el dictado…'
            : 'Escuchando. Pulsa Parar cuando termines; después podrás revisar el texto.'}
        </p>
      )}
      {!dictando && dictadoOriginal !== null && (
        <div className="revision-dictado" data-testid="revision-dictado">
          <p>Revisa el dictado antes de enviarlo.</p>
          {dictadoOriginal !== texto && (
            <button type="button" onClick={() => setTexto(dictadoOriginal)} disabled={pendiente}>
              Recuperar dictado original
            </button>
          )}
        </div>
      )}

      <form
        className="entrada"
        onSubmit={(evento) => {
          evento.preventDefault();
          void enviar(texto);
        }}
      >
        <textarea
          ref={entrada}
          rows={3}
          value={visible}
          disabled={pendiente}
          readOnly={dictando}
          aria-label={
            modo === 'instruir' ? 'Instrucción para el asistente' : 'Pregunta para el asistente'
          }
          placeholder={modo === 'instruir' ? 'Instrucción…' : 'Pregunta…'}
          data-testid="entrada-asistente"
          onChange={(evento) => setTexto(evento.target.value)}
        />

        {voz.supported && (
          <button
            type="button"
            className={voz.listening ? 'escuchando' : ''}
            title={voz.listening ? 'Parar dictado' : 'Dictar'}
            disabled={pendiente || voz.stopping || (modo === 'instruir' && !canWrite)}
            data-testid="dictar"
            onClick={() => {
              if (voz.listening) voz.stop();
              else {
                antesDelDictado.current = texto;
                setDictadoOriginal(null);
                voz.start();
              }
            }}
          >
            {voz.listening ? 'Parar' : voz.stopping ? 'Finalizando…' : 'Dictar'}
          </button>
        )}
        {dictando && (
          <button
            type="button"
            onClick={() => {
              voz.cancel();
              setTexto(antesDelDictado.current);
            }}
          >
            Cancelar dictado
          </button>
        )}

        <button
          type="submit"
          disabled={
            pendiente ||
            contextoLleno ||
            dictando ||
            texto.trim() === '' ||
            texto.trim().length > 2000 ||
            (modo === 'instruir' && !canWrite)
          }
          data-testid="enviar-asistente"
        >
          {pendiente ? '…' : 'Enviar'}
        </button>
        {pendiente && (
          <button type="button" onClick={cancelarSolicitud} data-testid="cancelar-solicitud">
            Cancelar solicitud
          </button>
        )}
      </form>
      <p className={visible.trim().length > 2000 ? 'error' : 'limite-asistente'}>
        {visible.trim().length}/2000 caracteres
        {visible.trim().length > 2000
          ? '. Acorta el texto antes de enviar; tu dictado se conserva completo.'
          : ''}
      </p>
    </section>
  );
}

function entradaDe(
  outcome: Outcome,
  expected: SemanticModel,
  instruction: string,
  context: readonly TurnoDeContexto[],
): Entrada {
  switch (outcome.kind) {
    case 'BATCH':
    case 'CONFIRMATION':
      return {
        rol: 'propuesta',
        outcome,
        aplicada: false,
        obsolete: false,
        expected,
        instruction,
        context,
      };

    case 'QUESTION':
      return {
        rol: 'asistente',
        texto: clarificationText(outcome.question, outcome.options),
      };

    case 'REJECTED':
      return {
        rol: 'asistente',
        texto: `No puedo hacer eso: ${outcome.issues.map((item) => item.message).join(' ')}`,
      };
  }
}
