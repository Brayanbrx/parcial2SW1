import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import { TourCoach } from './TourCoach.js';
import { readTourStep, tourForPath, tourProgressKey, tours } from './tour-steps.js';

const TourContext = createContext<{
  start(topic?: string, resume?: boolean): void;
  pause(): void;
} | null>(null);
export function useInteractiveTour() {
  const context = useContext(TourContext);
  if (!context) throw new Error('InteractiveTourProvider is required');
  return context;
}

export function InteractiveTourProvider({ children }: { readonly children: ReactNode }) {
  const { pathname } = useLocation();
  const kind = tourForPath(pathname);
  const [run, setRun] = useState<{ path: string; index: number } | null>(null);
  const pause = useCallback(() => {
    setRun(null);
    document
      .querySelector<HTMLButtonElement>('.ayuda-software-boton')
      ?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    if (!run || run.path === pathname) return;
    // Navigation is always performed by the user. Continue in the screen they opened.
    setRun(kind ? { path: pathname, index: 0 } : null);
  }, [pathname, kind, run]);
  useEffect(() => {
    if (!run || !kind || run.path !== pathname) return;
    try {
      const step = tours[kind].steps[run.index];
      if (step) localStorage.setItem(tourProgressKey, JSON.stringify({ kind, step: step.id }));
      else localStorage.removeItem(tourProgressKey);
    } catch {
      /* The interactive tour also works when storage is unavailable. */
    }
  }, [run, kind, pathname]);
  const start = (topic?: string, resume = false) => {
    if (!kind) return;
    let index = -1;
    if (resume) {
      try {
        index = readTourStep(localStorage.getItem(tourProgressKey), kind);
      } catch {
        /* Start from the context. */
      }
    }
    if (index < 0) index = tours[kind].steps.findIndex((step) => step.id === topic);
    setRun({ path: pathname, index: Math.max(0, index) });
  };
  return (
    <TourContext.Provider value={{ start, pause }}>
      {children}
      {run && kind && run.path === pathname && (
        <TourCoach
          key={`${pathname}:${run.index}`}
          kind={kind}
          index={run.index}
          move={(index) =>
            setRun({
              path: pathname,
              index: Math.max(0, Math.min(index, tours[kind].steps.length)),
            })
          }
          pause={pause}
        />
      )}
    </TourContext.Provider>
  );
}
