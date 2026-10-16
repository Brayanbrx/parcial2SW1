/** Captures the complete rendered diagram without changing the user's camera. */
export async function exportDiagramPng(): Promise<Blob> {
  const viewport = document.querySelector<HTMLElement>(
    '[data-testid="pizarra-diagrama"] .react-flow__viewport',
  );
  if (viewport === null || viewport.querySelector('.react-flow__node') === null) {
    throw new Error('Añade al menos una clase antes de exportar la imagen.');
  }

  await document.fonts.ready;
  const { toBlob } = await import('html-to-image');
  // SVG bounds include labels, markers, parallel relations and recursive loops.
  // React Flow renders offscreen nodes too (onlyRenderVisibleElements is false).
  const rectangles = Array.from(
    viewport.querySelectorAll('.react-flow__node, .react-flow__edge'),
    (element) => element.getBoundingClientRect(),
  );
  const origin = viewport.getBoundingClientRect();
  const zoom = new DOMMatrixReadOnly(getComputedStyle(viewport).transform).a;
  if (!Number.isFinite(zoom) || zoom <= 0) {
    throw new Error('El diagrama todavía no está listo. Intenta exportarlo de nuevo.');
  }
  const left = Math.min(...rectangles.map((rect) => rect.left));
  const top = Math.min(...rectangles.map((rect) => rect.top));
  const right = Math.max(...rectangles.map((rect) => rect.right));
  const bottom = Math.max(...rectangles.map((rect) => rect.bottom));
  const padding = 32;
  const width = Math.ceil((right - left) / zoom + padding * 2);
  const height = Math.ceil((bottom - top) / zoom + padding * 2);
  // Bound both canvas dimensions and memory for very large boards.
  const pixelRatio = Math.min(
    2,
    8192 / width,
    8192 / height,
    Math.sqrt(16_000_000 / (width * height)),
  );
  if (pixelRatio < 0.25) {
    throw new Error(
      'El diagrama es demasiado grande para una imagen legible. Acerca las clases e inténtalo de nuevo.',
    );
  }
  const backgroundColor =
    getComputedStyle(viewport.closest('.react-flow') ?? viewport)
      .getPropertyValue('--diagrama-fondo')
      .trim() || '#ffffff';
  const blob = await toBlob(viewport, {
    width,
    height,
    pixelRatio,
    backgroundColor,
    // The application uses system fonts; avoid traversing external stylesheets.
    skipFonts: true,
    filter: (node) =>
      !(
        node instanceof Element &&
        node.matches(
          '.react-flow__handle, .react-flow__resize-control, .editando, .asociacion-zona',
        )
      ),
    style: {
      width: `${width}px`,
      height: `${height}px`,
      transformOrigin: '0 0',
      transform: `translate(${padding - (left - origin.left) / zoom}px, ${padding - (top - origin.top) / zoom}px) scale(1)`,
    },
  });
  if (blob === null) throw new Error('No se pudo crear la imagen. Inténtalo de nuevo.');
  return blob;
}
