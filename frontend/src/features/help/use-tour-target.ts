import { useEffect, useState } from 'react';
import type { TourStep } from './tour-steps.js';

export function tourTarget(testId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
}

export function useTourTarget(step: TourStep | undefined) {
  const [anchor, setAnchor] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
    disabled: boolean;
  } | null>(null);
  const [done, setDone] = useState(false);
  useEffect(() => {
    setDone(false);
    setAnchor(null);
    if (!step) return;
    let frame = 0;
    let scrolled: HTMLElement | null = null;
    const measure = () => {
      frame = 0;
      const target = tourTarget(step.target);
      if (!target || target.closest('[hidden]') || target.getClientRects().length === 0) {
        setAnchor(null);
        return;
      }
      if (scrolled !== target) {
        scrolled = target;
        target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      }
      const box = target.getBoundingClientRect();
      const next = {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        disabled: target.matches(':disabled'),
      };
      setAnchor((old) =>
        old &&
        Object.keys(next).every(
          (key) => old[key as keyof typeof old] === next[key as keyof typeof next],
        )
          ? old
          : next,
      );
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const checkAction = (event: Event) => {
      const target = tourTarget(step.target);
      if (
        !target ||
        target.matches(':disabled') ||
        !(event.target instanceof Node) ||
        !target.contains(event.target)
      )
        return;
      if (step.action === 'click' && event.type === 'click') setDone(true);
      if (
        step.action === 'input' &&
        event.type === 'input' &&
        (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)
      ) {
        setDone(target.value.trim().length > 0);
      }
    };
    // Panel visibility changes and async data can replace or move a target.
    const observer = new MutationObserver((changes) => {
      if (
        changes.some(
          (change) =>
            !(
              change.target instanceof Element ? change.target : change.target.parentElement
            )?.closest('[data-tour-ui]'),
        )
      )
        schedule();
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['hidden', 'disabled', 'class', 'style'],
    });
    const resize = () => {
      // Responsive layouts can move an unchanged target outside the viewport.
      scrolled = null;
      schedule();
    };
    window.addEventListener('resize', resize);
    window.addEventListener('scroll', schedule, true);
    document.addEventListener('input', checkAction);
    document.addEventListener('click', checkAction);
    schedule();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', resize);
      window.removeEventListener('scroll', schedule, true);
      document.removeEventListener('input', checkAction);
      document.removeEventListener('click', checkAction);
    };
  }, [step]);
  return { anchor, done };
}
