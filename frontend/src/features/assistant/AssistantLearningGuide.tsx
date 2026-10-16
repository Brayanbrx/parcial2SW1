import { useId, useRef, useState } from 'react';
import type { SemanticModel } from '@uml/contracts';
import { instructionExample, learningSteps, type AssistantMode } from './learning-guide.js';

const completionKey = 'uml.assistant-learning.v1';

interface Props {
  readonly model: SemanticModel;
  readonly canWrite: boolean;
  readonly canUseExample: boolean;
  useExample(mode: AssistantMode, text: string): void;
}

export function AssistantLearningGuide({ model, canWrite, canUseExample, useExample }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const [step, setStep] = useState(0);
  const [answer, setAnswer] = useState<'send' | 'review' | null>(null);
  const [completed, setCompleted] = useState(() => {
    try {
      return localStorage.getItem(completionKey) === 'completed';
    } catch {
      return false;
    }
  });
  const lesson = learningSteps[step]!;
  const example =
    step === 0 ? '¿Qué clases hay en el diagrama y cómo se relacionan?' : instructionExample(model);

  function finish() {
    setCompleted(true);
    try {
      localStorage.setItem(completionKey, 'completed');
    } catch {
      // The guide remains usable when the browser blocks local storage.
    }
    dialog.current?.close();
  }

  return (
    <>
      <button type="button" onClick={() => dialog.current?.showModal()}>
        {completed ? 'Repasar guía de IA' : 'Aprender a usar la IA'}
      </button>
      <dialog ref={dialog} className="guia-ia" aria-labelledby={headingId}>
        <header className="guia-ia-cabecera">
          <h2 id={headingId}>Aprende a usar el asistente</h2>
          <button
            type="button"
            autoFocus
            onClick={() => dialog.current?.close()}
            aria-label="Cerrar guía"
          >
            Cerrar
          </button>
        </header>
        <p>Guía interactiva · Puedes practicar sin enviar solicitudes ni cambiar el diagrama.</p>
        <div aria-live="polite" aria-atomic="true">
          <p className="guia-ia-paso">
            Paso {step + 1} de {learningSteps.length}
          </p>
          <h3>{lesson.title}</h3>
          <p>{lesson.text}</p>
          <p className="guia-ia-consejo">{lesson.tip}</p>
        </div>
        {step < 2 && (
          <div className="guia-ia-ejemplo">
            <h4>Ejemplo para tu pizarra</h4>
            <p>{example}</p>
            <button
              type="button"
              disabled={!canUseExample || (step === 1 && !canWrite)}
              onClick={() => {
                dialog.current?.close();
                useExample(step === 0 ? 'preguntar' : 'instruir', example);
              }}
            >
              Usar ejemplo como borrador
            </button>
            <p className="guia-ia-nota">
              {!canUseExample
                ? 'Conservamos tu trabajo: termina la solicitud o el dictado y vacía el borrador. Si hay una aclaración en curso, resuélvela o pulsa Empezar de nuevo.'
                : step === 1 && !canWrite
                  ? 'Tu rol permite consultar. Para instruir necesitas permiso de edición.'
                  : 'Solo rellena el cuadro de texto. Tú decides si lo editas y lo envías.'}
            </p>
          </div>
        )}
        {step === learningSteps.length - 1 && (
          <fieldset className="guia-ia-practica">
            <legend>Práctica: la IA propone borrar una clase. ¿Qué haces?</legend>
            <label>
              <input
                type="radio"
                name={headingId}
                checked={answer === 'send'}
                onChange={() => setAnswer('send')}
              />
              Aplicar sin revisar porque lo propuso la IA.
            </label>
            <label>
              <input
                type="radio"
                name={headingId}
                checked={answer === 'review'}
                onChange={() => setAnswer('review')}
              />
              Revisar lo que se borrará y aplicar solo si es lo que pedí.
            </label>
            <p role="status">
              {answer === 'review'
                ? 'Correcto. La IA puede equivocarse; tú confirmas los cambios después de revisarlos.'
                : answer === 'send'
                  ? 'Antes de aplicar, comprueba el alcance del cambio. Puedes dejar la propuesta sin aplicar y pedir una corrección.'
                  : 'Esta práctica no modifica tu pizarra.'}
            </p>
          </fieldset>
        )}
        <nav aria-label="Pasos de la guía" className="guia-ia-acciones">
          <button type="button" disabled={step === 0} onClick={() => setStep(step - 1)}>
            Anterior
          </button>
          {step < learningSteps.length - 1 ? (
            <button type="button" className="principal" onClick={() => setStep(step + 1)}>
              Siguiente
            </button>
          ) : (
            <button
              type="button"
              className="principal"
              disabled={answer !== 'review'}
              onClick={finish}
            >
              Completar guía
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setStep(0);
              setAnswer(null);
            }}
          >
            Reiniciar guía
          </button>
        </nav>
        <details className="guia-ia-ayuda">
          <summary>¿La IA no responde o no puedo aplicar?</summary>
          <p>
            Para enviar solicitudes necesitas conexión y un proveedor de IA disponible en el
            servidor. Revisa el mensaje de error; si indica un límite, espera antes de reintentar.
            Esta guía sigue disponible mientras tengas abierta la aplicación.
          </p>
          <p>
            Si solicita una aclaración, contesta con el dato que falta. Para cambiar de tema, pulsa
            Empezar de nuevo. Aplicar requiere permiso de edición y una propuesta vigente.
          </p>
        </details>
      </dialog>
    </>
  );
}
