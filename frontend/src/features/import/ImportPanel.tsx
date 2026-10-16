import {
  type BoardState,
  type Command,
  type CommandBatch,
  type SemanticModel,
  type ValidationIssue,
} from '@uml/contracts';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { planBatch, validateModel } from '@uml/domain-core';
import { CandidateEditor, etiquetaComando } from './CandidateEditor.js';
import { removeCandidateCommand } from './candidate.js';
import { apiRequest, downloadXmi } from '../../lib/api.js';
import { descargarBlob, nombreDeArchivo } from '../../lib/guardar-archivo.js';
import { CapturaCamara } from './CapturaCamara.js';
import { ExportImage } from './ExportImage.js';

/**
 * Importacion por foto y XMI, y exportacion a XMI (M4 y M5).
 *
 * La foto entra de dos maneras: subiendo un archivo o tomandola con la camara
 * del dispositivo. La segunda existe porque la primera obliga a un rodeo —sacar
 * la foto con el telefono, pasarla al portatil, buscarla en el explorador— y en
 * una defensa ese rodeo son minutos delante del tribunal.
 *
 * **Nada se aplica solo.** Lo que llega es un candidato con su resumen, y el
 * usuario lo revisa antes de aceptarlo: leer un diagrama a mano se va a
 * equivocar en algo, y un candidato que no se puede corregir no sirve (CA-042.1).
 *
 * Los campos principales del candidato se pueden corregir aqui antes de aplicar.
 * El lote conserva sus UUID resueltos; editar un nombre o un tipo no abre una
 * segunda via de escritura y sigue pasando por el mismo aplicador atomico.
 */

type Outcome =
  | { kind: 'BATCH'; batch: CommandBatch; summary: string[] }
  | { kind: 'CONFIRMATION'; batch: CommandBatch; summary: string[]; question: string }
  | { kind: 'QUESTION'; question: string; options?: string[] }
  | { kind: 'NO_CHANGES'; message: string }
  | { kind: 'REJECTED'; issues: ValidationIssue[] };

type Respuesta = Outcome & {
  rationale: string | null;
  warnings: { element: string; reason: string }[];
};

export interface ImportPanelProps {
  readonly boardId: string;
  readonly boardName: string;
  readonly state: BoardState;
  readonly canWrite: boolean;
  apply(
    batch: CommandBatch,
    expected?: SemanticModel,
    scope?: 'AFFECTED' | 'MODEL',
  ): readonly ValidationIssue[] | null;
}

type Modo = 'ADD' | 'REPLACE';
type Fuente =
  | { kind: 'XMI'; name: string; xml: string }
  | { kind: 'IMAGE'; name: string; image: string; mediaType: string };

export function ImportPanel({
  boardId,
  boardName,
  state,
  canWrite,
  apply,
}: ImportPanelProps): React.JSX.Element {
  const [candidato, setCandidato] = useState<Respuesta | null>(null);
  const [baseCandidato, setBaseCandidato] = useState<{ model: SemanticModel; modo: Modo } | null>(
    null,
  );
  const [obsoleto, setObsoleto] = useState(false);
  const [aplicado, setAplicado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, setPendiente] = useState(false);
  const [modo, setModo] = useState<Modo>('ADD');
  const [fuente, setFuente] = useState<Fuente | null>(null);
  const [camaraAbierta, setCamaraAbierta] = useState(false);
  const [nombreExport, setNombreExport] = useState<string | null>(null);
  const [formatoExport, setFormatoExport] = useState<'EA_21' | 'UML_251'>('EA_21');
  const imagenRef = useRef<HTMLInputElement>(null);
  const xmiRef = useRef<HTMLInputElement>(null);
  const exportRef = useRef<HTMLFormElement>(null);
  const candidateRef = useRef<HTMLDivElement>(null);
  const exportOpen = nombreExport !== null;
  const candidateOpen = candidato !== null;

  // Los formularios se insertan debajo de los controles de importación. Al
  // abrirlos, desplaza el panel hasta el trabajo nuevo, sin moverlo al escribir.
  //
  // El desplazamiento se repite en el siguiente cuadro: al insertar el
  // formulario, el panel todavía no conoce su alto final —`:has(.candidato)` le
  // cambia el reparto de la columna— y el primer intento no tiene nada que
  // desplazar. Sin la segunda pasada, el panel se queda arriba y lo nuevo
  // aparece fuera de la vista.
  useAparecerALaVista(exportOpen, exportRef, 'end');
  // Y hasta las filas editables, no hasta la cabecera del candidato: alinear su
  // principio dejaba justo el editor debajo de la barra fija de «Aplicar», que
  // se pega al pie del panel. Se veía el botón y no lo que hay que corregir.
  useAparecerALaVista(candidateOpen, candidateRef, 'start', '.editor-candidato');
  const preview = useMemo(() => {
    if (candidato === null || !('batch' in candidato)) return null;
    const plan = planBatch(state, candidato.batch);
    return {
      applied: plan.applied,
      issues: plan.applied ? validateModel(plan.state.semantic) : plan.issues,
    };
  }, [candidato, state]);
  const nombres = new Map(state.semantic.classes.map((c) => [c.id, c.displayName]));
  if (candidato !== null && 'batch' in candidato)
    for (const c of candidato.batch.commands) {
      if (c.type === 'CREATE_CLASS' || c.type === 'RENAME_CLASS')
        nombres.set(c.payload.classId, c.payload.displayName);
    }
  const resumen =
    candidato !== null && 'batch' in candidato
      ? candidato.batch.commands.map((c) => etiquetaComando(c, nombres))
      : [];

  async function enviar(hacer: () => Promise<Respuesta>): Promise<void> {
    setPendiente(true);
    setError(null);
    setAplicado(null);
    setCandidato(null);
    setObsoleto(false);

    try {
      setCandidato(await hacer());
    } catch (causa) {
      setError(causa instanceof Error ? causa.message : 'La importación falló.');
    } finally {
      setPendiente(false);
    }
  }

  async function importarImagen(archivo: File): Promise<void> {
    const base64 = await leerBase64(archivo);
    const nuevaFuente: Fuente = {
      kind: 'IMAGE',
      name: archivo.name,
      image: base64,
      mediaType: archivo.type,
    };
    setFuente(nuevaFuente);
    await importarFuente(nuevaFuente, modo);
  }

  async function importarXmi(archivo: File): Promise<void> {
    const xml = await archivo.text();
    const nuevaFuente: Fuente = { kind: 'XMI', name: archivo.name, xml };
    setFuente(nuevaFuente);
    await importarFuente(nuevaFuente, modo);
  }

  async function importarFuente(origen: Fuente, nuevoModo: Modo): Promise<void> {
    setBaseCandidato({ model: state.semantic, modo: nuevoModo });
    await enviar(() =>
      origen.kind === 'XMI'
        ? apiRequest<Respuesta>(`/boards/${boardId}/import/xmi`, {
            method: 'POST',
            body: { xml: origen.xml, mode: nuevoModo, model: state.semantic },
          })
        : apiRequest<Respuesta>(`/boards/${boardId}/import/image`, {
            method: 'POST',
            body: {
              image: origen.image,
              mediaType: origen.mediaType,
              mode: nuevoModo,
              model: state.semantic,
            },
          }),
    );
  }

  async function reintentarReemplazando(): Promise<void> {
    if (fuente === null) return;
    setModo('REPLACE');
    await importarFuente(fuente, 'REPLACE');
  }

  async function exportar(): Promise<void> {
    setError(null);

    try {
      const { blob } = await downloadXmi(boardId, state.semantic, state.layout, formatoExport);
      const nombre = nombreDeArchivo(nombreExport ?? boardName, '.xmi');

      descargarBlob(blob, nombre);
      setNombreExport(null);
      setAplicado(`Exportado como ${nombre}`);
    } catch (causa) {
      setError(causa instanceof Error ? causa.message : 'La exportación falló.');
    }
  }

  function aplicar(batch: CommandBatch, resumen: readonly string[]): void {
    if (baseCandidato === null || obsoleto) return;
    const rechazo = apply(
      batch,
      baseCandidato.model,
      baseCandidato.modo === 'REPLACE' ? 'MODEL' : 'AFFECTED',
    );

    if (rechazo !== null && rechazo.length > 0) {
      const stale = rechazo.some((issue) => issue.code === 'STALE_PROPOSAL');
      setObsoleto(stale);
      setError(
        stale
          ? 'La pizarra cambió desde que se preparó la importación. Vuelve a preparar el archivo y revisa el candidato nuevo; las correcciones del candidato anterior deberán revisarse de nuevo.'
          : `No se pudo aplicar: ${rechazo[0]?.message ?? 'el lote fue rechazado.'}`,
      );
      return;
    }

    // El candidato desaparecia sin decir nada, y desde el panel no se ve el
    // lienzo entero: quedaba la duda de si se habia aplicado o descartado.
    setAplicado(`Aplicado: ${resumen.length} ${resumen.length === 1 ? 'cambio' : 'cambios'}.`);
    setCandidato(null);
    setFuente(null);
  }

  function actualizarComando(commandId: string, editar: (command: Command) => Command): void {
    setCandidato((actual) => {
      if (actual === null || (actual.kind !== 'BATCH' && actual.kind !== 'CONFIRMATION')) {
        return actual;
      }
      return {
        ...actual,
        batch: {
          ...actual.batch,
          commands: actual.batch.commands.map((command) =>
            command.commandId === commandId ? editar(command) : command,
          ),
        },
      };
    });
  }

  return (
    <section className="importacion" data-testid="importacion">
      <h3>Importar y exportar</h3>

      <label className="modo">
        <span>Al importar</span>
        <select
          value={modo}
          disabled={!canWrite || pendiente || candidato !== null}
          data-testid="modo-importacion"
          onChange={(evento) => setModo(evento.target.value as Modo)}
        >
          <option value="ADD">Añadir a lo que hay</option>
          <option value="REPLACE">Reemplazar el contenido</option>
        </select>
      </label>

      <div className="acciones">
        <button
          type="button"
          disabled={!canWrite || pendiente}
          data-testid="importar-imagen"
          onClick={() => imagenRef.current?.click()}
        >
          {pendiente ? 'Leyendo…' : 'Subir foto'}
        </button>

        <button
          type="button"
          disabled={!canWrite || pendiente}
          data-testid="abrir-camara"
          onClick={() => setCamaraAbierta(true)}
        >
          Tomar foto
        </button>

        <button
          type="button"
          disabled={!canWrite || pendiente}
          data-testid="importar-xmi"
          onClick={() => xmiRef.current?.click()}
        >
          Importar XMI
        </button>

        <button type="button" data-testid="exportar-xmi" onClick={() => setNombreExport(boardName)}>
          Exportar XMI
        </button>
      </div>

      <ExportImage boardName={boardName} empty={state.semantic.classes.length === 0} />

      <input
        ref={imagenRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        hidden
        data-testid="archivo-imagen"
        onChange={(evento) => {
          const archivo = evento.target.files?.[0];
          evento.target.value = '';
          if (archivo !== undefined) void importarImagen(archivo);
        }}
      />

      <input
        ref={xmiRef}
        type="file"
        accept=".xmi,.xml,text/xml,application/xml"
        hidden
        data-testid="archivo-xmi"
        onChange={(evento) => {
          const archivo = evento.target.files?.[0];
          evento.target.value = '';
          if (archivo !== undefined) void importarXmi(archivo);
        }}
      />

      {nombreExport !== null && (
        <form
          ref={exportRef}
          className="nombre-export"
          data-testid="nombre-export"
          onSubmit={(evento) => {
            evento.preventDefault();
            void exportar();
          }}
        >
          <label>
            <span>Nombre del archivo</span>
            <input
              value={nombreExport}
              autoFocus
              data-testid="campo-nombre-export"
              onChange={(evento) => setNombreExport(evento.target.value)}
            />
          </label>
          <label>
            <span>Formato XMI</span>
            <select
              value={formatoExport}
              onChange={(evento) =>
                setFormatoExport(evento.target.value === 'UML_251' ? 'UML_251' : 'EA_21')
              }
            >
              <option value="EA_21">Enterprise Architect 15 — XMI 2.1</option>
              <option value="UML_251">UML 2.5.1 — XMI 2.5.1</option>
            </select>
          </label>
          <p className="pista">
            Se guardará como <code>{nombreDeArchivo(nombreExport, '.xmi')}</code>
          </p>
          <div className="acciones">
            <button type="submit" data-testid="confirmar-export">
              Guardar
            </button>
            <button type="button" className="secundario" onClick={() => setNombreExport(null)}>
              Cancelar
            </button>
          </div>
        </form>
      )}

      {camaraAbierta && (
        <CapturaCamara
          onCerrar={() => setCamaraAbierta(false)}
          onCaptura={(archivo) => {
            setCamaraAbierta(false);
            void importarImagen(archivo);
          }}
        />
      )}

      {error !== null && (
        <p className="error" data-testid="error-importacion">
          {error}
        </p>
      )}

      {aplicado !== null && (
        <p className="aplicada" data-testid="importacion-aplicada">
          {aplicado}
        </p>
      )}

      {candidato !== null && (
        <div ref={candidateRef} className="candidato" data-testid="candidato">
          <div className="candidato-cabecera">
            <strong>Antes de aplicar</strong>
            {fuente !== null && <span title={fuente.name}>{fuente.name}</span>}
          </div>

          {candidato.rationale !== null && <p className="derivados">{candidato.rationale}</p>}

          {/* Abierto: aqui viene lo que la lectura omitio o supuso, y un candidato
              con avisos plegados se aplica sin leerlos. */}
          {candidato.warnings.length > 0 && (
            <details className="bloque-avisos" open>
              <summary>
                {candidato.warnings.length} aviso{candidato.warnings.length === 1 ? '' : 's'}{' '}
                {fuente?.kind === 'IMAGE' ? 'de la lectura' : 'del archivo'}
              </summary>
              <ul className="avisos-importacion" data-testid="avisos-importacion">
                {candidato.warnings.map((aviso, indice) => (
                  <li key={indice}>
                    <strong>{aviso.element}</strong>: {aviso.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {(candidato.kind === 'BATCH' || candidato.kind === 'CONFIRMATION') && (
            <>
              {candidato.kind === 'CONFIRMATION' && (
                <p className="advertencia">{candidato.question}</p>
              )}

              <p className="pista">
                Corrige lo que haga falta. Nada entra al diagrama hasta que apliques.
              </p>

              <CandidateEditor
                batch={candidato.batch}
                state={state}
                onChange={actualizarComando}
                onRemove={(commandId) =>
                  setCandidato((current) =>
                    current !== null && 'batch' in current
                      ? { ...current, batch: removeCandidateCommand(current.batch, commandId) }
                      : current,
                  )
                }
              />
              {preview !== null && preview.issues.length > 0 && (
                <div
                  className="validacion-candidato"
                  data-testid="validacion-candidato"
                  aria-live="polite"
                >
                  <strong>
                    {preview.applied
                      ? 'Revisa estos hallazgos antes de generar código'
                      : 'Corrige estos errores para aplicar'}
                  </strong>
                  <ul>
                    {preview.issues.map((issue, i) => (
                      <li key={`${issue.code}-${i}`}>{issue.message}</li>
                    ))}
                  </ul>
                </div>
              )}

              <details className="resumen-tecnico">
                <summary>Ver resumen de {resumen.length} operaciones</summary>
                <ul className="resumen">
                  {resumen.slice(0, 20).map((linea, indice) => (
                    <li key={indice}>{linea}</li>
                  ))}
                  {resumen.length > 20 && <li className="pista">y {resumen.length - 20} más…</li>}
                </ul>
              </details>

              <div className="acciones">
                <button
                  type="button"
                  className="principal"
                  disabled={
                    !canWrite || obsoleto || preview?.applied === false || resumen.length === 0
                  }
                  data-testid="aplicar-candidato"
                  onClick={() => aplicar(candidato.batch, resumen)}
                >
                  Aplicar {resumen.length} cambio
                  {resumen.length === 1 ? '' : 's'}
                </button>
                {obsoleto && fuente !== null && baseCandidato !== null && (
                  <button
                    type="button"
                    disabled={!canWrite || pendiente}
                    data-testid="repreparar-importacion"
                    onClick={() => void importarFuente(fuente, baseCandidato.modo)}
                  >
                    Volver a preparar
                  </button>
                )}
                <button type="button" onClick={() => setCandidato(null)}>
                  Descartar
                </button>
              </div>
            </>
          )}

          {candidato.kind === 'NO_CHANGES' && (
            <>
              <p className="estado-vacio">✓ {candidato.message}</p>
              <div className="acciones">
                {fuente !== null && (
                  <button
                    type="button"
                    className="principal"
                    disabled={pendiente}
                    onClick={() => void reintentarReemplazando()}
                  >
                    Reemplazar con este archivo
                  </button>
                )}
                <button type="button" onClick={() => setCandidato(null)}>
                  Cerrar
                </button>
              </div>
            </>
          )}

          {candidato.kind === 'QUESTION' && (
            <>
              <p className="advertencia">{candidato.question}</p>
              {candidato.options !== undefined && candidato.options.length > 0 && (
                <p className="pista">Coincidencias: {candidato.options.join(', ')}</p>
              )}
              {/* Sin lote no hay nada que aplicar, y repetir la lectura cuesta otra
                  llamada al proveedor: se explica y se deja a la persona decidir si
                  sube otra foto o corrige la pizarra antes. */}
              <p className="pista">
                La lectura no produjo ningún cambio que preparar. Puedes subir otra foto o ajustar
                la pizarra y volver a intentarlo.
              </p>
              <div className="acciones">
                <button type="button" onClick={() => setCandidato(null)}>
                  Cerrar
                </button>
              </div>
            </>
          )}

          {candidato.kind === 'REJECTED' && (
            <>
              <p className="error">
                {candidato.issues.map((hallazgo) => hallazgo.message).join(' ')}
              </p>
              <div className="acciones">
                <button type="button" onClick={() => setCandidato(null)}>
                  Cerrar
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * Trae a la vista lo que acaba de abrirse dentro del panel que se desplaza.
 *
 * `dentro` apunta a la parte que de verdad hay que ver cuando el bloque entero
 * no cabe; si no existe, se usa el bloque.
 */
function useAparecerALaVista<T extends HTMLElement>(
  abierto: boolean,
  bloque: React.RefObject<T | null>,
  block: ScrollLogicalPosition,
  dentro?: string,
): void {
  useLayoutEffect(() => {
    if (!abierto) return;
    const mostrar = (): void => {
      const raiz = bloque.current;
      if (raiz === null) return;
      const destino = dentro === undefined ? raiz : (raiz.querySelector(dentro) ?? raiz);
      destino.scrollIntoView({ block });
    };
    mostrar();
    const cuadro = requestAnimationFrame(mostrar);
    return () => cancelAnimationFrame(cuadro);
  }, [abierto, bloque, block, dentro]);
}

/** El servidor recibe la imagen en base64: no hay multipart en esta API. */
async function leerBase64(archivo: File): Promise<string> {
  const bytes = new Uint8Array(await archivo.arrayBuffer());
  let binario = '';

  // Por trozos: `String.fromCharCode(...bytes)` con una foto de varios megas
  // desborda la pila de argumentos.
  const TROZO = 8192;
  for (let indice = 0; indice < bytes.length; indice += TROZO) {
    binario += String.fromCharCode(...bytes.subarray(indice, indice + TROZO));
  }

  return btoa(binario);
}
