import { useState } from 'react';
import { descargarBlob, nombreDeArchivo } from '../../lib/guardar-archivo.js';

export function ExportImage({
  boardName,
  empty,
}: {
  readonly boardName: string;
  readonly empty: boolean;
}) {
  const [name, setName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function download() {
    if (busy || name === null) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const { exportDiagramPng } = await import('../editor/export-image.js');
      const blob = await exportDiagramPng();
      const filename = nombreDeArchivo(name, '.png');
      descargarBlob(blob, filename);
      setName(null);
      setSuccess(`Exportado como ${filename}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'La exportación de imagen falló.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        data-testid="exportar-png"
        disabled={empty || busy}
        onClick={() => {
          setName(boardName);
          setError(null);
          setSuccess(null);
        }}
      >
        Exportar imagen PNG
      </button>
      <p className="pista">
        {empty
          ? 'Añade una clase para exportar una imagen.'
          : 'Descarga el diagrama completo con el tema actual, también lo que queda fuera de la vista.'}
      </p>
      {name !== null && (
        <form
          className="nombre-export"
          aria-label="Exportar imagen PNG"
          aria-busy={busy}
          onSubmit={(event) => {
            event.preventDefault();
            void download();
          }}
        >
          <label>
            <span>Nombre de la imagen</span>
            <input
              autoFocus
              value={name}
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <p className="pista">
            Se guardará como <code>{nombreDeArchivo(name, '.png')}</code>
          </p>
          <div className="acciones">
            <button type="submit" disabled={busy || empty}>
              {busy ? 'Preparando imagen…' : 'Guardar PNG'}
            </button>
            <button
              type="button"
              className="secundario"
              disabled={busy}
              onClick={() => setName(null)}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}
      {error !== null && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {success !== null && (
        <p className="aplicada" role="status">
          {success}
        </p>
      )}
    </div>
  );
}
