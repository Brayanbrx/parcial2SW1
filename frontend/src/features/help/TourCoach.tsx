import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { tours, type TourKind } from './tour-steps.js';
import { tourTarget, useTourTarget } from './use-tour-target.js';

interface Props {
  readonly kind: TourKind;
  readonly index: number;
  move(index: number): void;
  pause(): void;
}

export function TourCoach({ kind, index, move, pause }: Props) {
  const tour = tours[kind];
  const step = tour.steps[index];
  const { anchor, done } = useTourTarget(step);
  const panel = useRef<HTMLElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const [size, setSize] = useState({
    width: 360,
    height: 340,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
  });
  useLayoutEffect(() => {
    const measure = () => {
      const box = panel.current?.getBoundingClientRect();
      if (box)
        setSize({
          width: box.width,
          height: box.height,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
        });
    };
    const observer = new ResizeObserver(measure);
    if (panel.current) observer.observe(panel.current);
    window.addEventListener('resize', measure);
    measure();
    close.current?.focus({ preventScroll: true });
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || document.querySelector('dialog[open]')) return;
      event.preventDefault();
      event.stopPropagation();
      pause();
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [pause]);

  function focusTarget() {
    if (!step) return;
    // Only disclosure buttons and tabs may be opened by the tour. Never submit forms.
    for (const id of step.reveal ?? []) {
      const control = tourTarget(id);
      if (
        control?.getAttribute('aria-expanded') === 'false' ||
        (control?.getAttribute('role') === 'tab' &&
          control.getAttribute('aria-selected') !== 'true')
      )
        control.click();
    }
    requestAnimationFrame(() => {
      const target = tourTarget(step.target);
      target?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      target?.focus({ preventScroll: true });
    });
  }

  const gap = 12;
  const maxX = Math.max(gap, size.viewportWidth - size.width - gap);
  const maxY = Math.max(gap, size.viewportHeight - size.height - gap);
  let left = maxX;
  let top = maxY;
  if (anchor) {
    if (size.viewportWidth > 700 && anchor.x - size.width > gap * 2) {
      left = anchor.x - size.width - gap;
      top = Math.max(gap, Math.min(anchor.y, maxY));
    } else if (
      size.viewportWidth > 700 &&
      anchor.x + anchor.width + size.width + gap * 2 < size.viewportWidth
    ) {
      left = anchor.x + anchor.width + gap;
      top = Math.max(gap, Math.min(anchor.y, maxY));
    } else {
      left = Math.max(gap, Math.min(anchor.x, maxX));
      top = anchor.y + anchor.height / 2 > size.viewportHeight / 2 ? gap : maxY;
    }
  }

  return createPortal(
    <div className="tour-layer" data-tour-ui="true">
      {anchor && (
        <div
          className="tour-spotlight"
          data-testid="tour-spotlight"
          aria-hidden="true"
          style={{
            left: Math.max(2, anchor.x - 4),
            top: Math.max(2, anchor.y - 4),
            width: Math.max(
              0,
              Math.min(anchor.width + 8, size.viewportWidth - Math.max(2, anchor.x - 4) - 2),
            ),
            height: Math.max(
              0,
              Math.min(anchor.height + 8, size.viewportHeight - Math.max(2, anchor.y - 4) - 2),
            ),
          }}
        />
      )}
      <section
        ref={panel}
        className="tour-coach"
        role="dialog"
        aria-modal="false"
        aria-labelledby="tour-title"
        aria-describedby="tour-description"
        style={{ left, top }}
      >
        <header>
          <span className="tour-eyebrow">RECORRIDO INTERACTIVO</span>
          <button type="button" ref={close} onClick={pause} aria-label="Pausar recorrido">
            Pausar
          </button>
        </header>
        {step ? (
          <>
            <p className="tour-progress-label">
              {tour.title} · {index + 1} de {tour.steps.length}
            </p>
            <progress value={index + 1} max={tour.steps.length} aria-label="Paso del recorrido" />
            <h2 id="tour-title">{step.title}</h2>
            <div className="tour-body">
              <p id="tour-description">{step.text}</p>
              <p className="tour-feedback" role="status">
                {!anchor
                  ? (step.unavailable ??
                    'Este control está oculto. Pulsa Mostrar control o abre el panel correspondiente.')
                  : anchor.disabled
                    ? 'Este control no está disponible ahora. Revisa tus permisos o los requisitos; puedes omitir el paso.'
                    : done
                      ? 'Acción detectada. Puedes continuar cuando termines.'
                      : step.action
                        ? 'Hazlo en el control resaltado. El recorrido detectará tu acción.'
                        : 'Explora el control resaltado y continúa cuando estés listo.'}
              </p>
              <button
                type="button"
                className="tour-target-button"
                onClick={focusTarget}
                disabled={anchor?.disabled}
              >
                {anchor ? 'Ir al control' : 'Mostrar control'}
              </button>
            </div>
            <nav aria-label="Controles del recorrido">
              <button type="button" onClick={() => move(index - 1)} disabled={index === 0}>
                Atrás
              </button>
              {step.action && !done ? (
                <>
                  <button type="button" onClick={() => move(index + 1)}>
                    Omitir paso
                  </button>
                  <button type="button" className="principal" disabled>
                    Siguiente
                  </button>
                </>
              ) : (
                <button type="button" className="principal" onClick={() => move(index + 1)}>
                  {index === tour.steps.length - 1 ? 'Terminar recorrido' : 'Siguiente'}
                </button>
              )}
            </nav>
            <p className="tour-note">
              Puedes usar la interfaz. Escape pausa y Ayuda permite retomar.
            </p>
          </>
        ) : (
          <>
            <h2 id="tour-title">Recorrido terminado</h2>
            <p id="tour-description">
              Ya recorriste {tour.title.toLocaleLowerCase()}. Puedes volver a practicar los pasos
              que omitiste o consultar la ayuda cuando lo necesites.
            </p>
            <nav aria-label="Final del recorrido">
              <button type="button" onClick={() => move(0)}>
                Repetir recorrido
              </button>
              <button type="button" className="principal" onClick={pause}>
                Cerrar recorrido
              </button>
            </nav>
          </>
        )}
      </section>
    </div>,
    document.body,
  );
}
