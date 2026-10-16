import { useId, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import { useInteractiveTour } from './InteractiveTour.js';
import {
  findSoftwareLessons,
  readSoftwareProgress,
  softwareLessons,
  softwareProgressKey,
} from './software-lessons.js';

function savedProgress(): readonly string[] {
  try {
    return readSoftwareProgress(localStorage.getItem(softwareProgressKey));
  } catch {
    return [];
  }
}

/** Built-in help: opening, searching and reading never execute application actions. */
export function SoftwareGuide({ topic }: { readonly topic?: string }) {
  const tour = useInteractiveTour();
  const { pathname } = useLocation();
  const contextualTopic = topic ?? (pathname === '/cuenta' ? 'account' : 'projects');
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [selected, setSelected] = useState(contextualTopic);
  const [query, setQuery] = useState('');
  const [completed, setCompleted] = useState<readonly string[]>(savedProgress);
  const [storageNotice, setStorageNotice] = useState('');
  const lesson = softwareLessons.find((item) => item.id === selected) ?? softwareLessons[0]!;
  const index = softwareLessons.indexOf(lesson);
  const results = findSoftwareLessons(query);

  function saveProgress(next: readonly string[]) {
    setCompleted(next);
    try {
      localStorage.setItem(softwareProgressKey, JSON.stringify(next));
      setStorageNotice('');
    } catch {
      setStorageNotice(
        'El navegador no permite guardar el progreso. Puedes seguir usando la guía durante esta sesión.',
      );
    }
  }

  return (
    <>
      <button
        type="button"
        className="ayuda-software-boton"
        aria-label="Aprender a usar el software"
        aria-haspopup="dialog"
        onClick={() => {
          tour.pause();
          setSelected(contextualTopic);
          setQuery('');
          dialog.current?.showModal();
        }}
      >
        Ayuda
      </button>
      <dialog ref={dialog} className="guia-ia guia-software" aria-labelledby={`${id}-title`}>
        <header className="guia-ia-cabecera">
          <h2 id={`${id}-title`}>Aprende a usar el software</h2>
          <button
            type="button"
            autoFocus
            aria-label="Cerrar ayuda del software"
            onClick={() => dialog.current?.close()}
          >
            Cerrar
          </button>
        </header>
        <p>
          Desde tu primer proyecto hasta la descarga de tu aplicación. Elige un tema o busca tu
          duda; esta ayuda no realiza cambios en tu trabajo.
        </p>
        <div className="guia-software-progreso">
          <button
            type="button"
            className="principal"
            onClick={() => {
              dialog.current?.close();
              tour.start(contextualTopic);
            }}
          >
            Guiarme en esta pantalla
          </button>
          <button
            type="button"
            onClick={() => {
              dialog.current?.close();
              tour.start(contextualTopic, true);
            }}
          >
            Retomar recorrido interactivo
          </button>
          <span role="status">
            {completed.length} de {softwareLessons.length} temas leídos
          </span>
          <button
            type="button"
            onClick={() => {
              setQuery('');
              setSelected(
                softwareLessons.find((item) => !completed.includes(item.id))?.id ?? 'projects',
              );
            }}
          >
            {completed.length === softwareLessons.length
              ? 'Repasar recorrido'
              : 'Continuar recorrido'}
          </button>
          <button type="button" disabled={completed.length === 0} onClick={() => saveProgress([])}>
            Reiniciar progreso
          </button>
        </div>
        {storageNotice && <p role="status">{storageNotice}</p>}
        <label className="guia-software-busqueda" htmlFor={`${id}-search`}>
          ¿Qué quieres aprender?
          <input
            id={`${id}-search`}
            type="search"
            value={query}
            placeholder="Ej.: invitar, crear clase, descargar Android"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="guia-software-contenido">
          <nav aria-label="Temas de ayuda del software">
            <p role="status">
              {results.length} {results.length === 1 ? 'tema disponible' : 'temas disponibles'}
            </p>
            {results.length === 0 ? (
              <div>
                <p>
                  No encontré un tema para esa búsqueda. Prueba con «proyecto», «atributo»,
                  «invitar» o «descargar».
                </p>
                <button type="button" onClick={() => setQuery('')}>
                  Ver todos los temas
                </button>
              </div>
            ) : (
              <ul className="guia-software-temas">
                {results.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      aria-current={selected === item.id ? 'step' : undefined}
                      onClick={() => setSelected(item.id)}
                    >
                      {item.title}
                      {completed.includes(item.id) && <small>Leído</small>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </nav>
          <section aria-label="Lección seleccionada" className="guia-software-leccion">
            <div aria-live="polite" aria-atomic="true">
              <p className="guia-ia-paso">
                Tema {index + 1} de {softwareLessons.length} · {lesson.title}
              </p>
              <h3>{lesson.question}</h3>
              <p>{lesson.summary}</p>
              <p className="guia-ia-consejo">
                <strong>Dónde está:</strong> {lesson.where}
              </p>
              <ol>
                {lesson.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              <div className="guia-ia-ejemplo">
                <h4>Prueba a tu ritmo</h4>
                <p>{lesson.practice}</p>
              </div>
              <p>{lesson.tip}</p>
            </div>
            <label className="guia-software-leido">
              <input
                type="checkbox"
                checked={completed.includes(lesson.id)}
                onChange={(event) =>
                  saveProgress(
                    event.target.checked
                      ? [...completed, lesson.id]
                      : completed.filter((value) => value !== lesson.id),
                  )
                }
              />
              Marcar este tema como leído
            </label>
            <nav aria-label="Recorrido de aprendizaje" className="guia-ia-acciones">
              <button
                type="button"
                disabled={index === 0}
                onClick={() => {
                  setQuery('');
                  setSelected(softwareLessons[index - 1]!.id);
                }}
              >
                Tema anterior
              </button>
              <button
                type="button"
                disabled={index === softwareLessons.length - 1}
                onClick={() => {
                  setQuery('');
                  setSelected(softwareLessons[index + 1]!.id);
                }}
              >
                Tema siguiente
              </button>
            </nav>
          </section>
        </div>
      </dialog>
    </>
  );
}
