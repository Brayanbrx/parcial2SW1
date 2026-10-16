import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Toma una foto con la cámara del dispositivo, sin salir de la aplicación.
 *
 * Existe porque subir un archivo obliga a un rodeo: sacar la foto con el
 * teléfono, pasarla al portátil y buscarla en el explorador. Con la cámara
 * abierta dentro del panel, el diagrama del pizarrón entra en dos toques.
 *
 * Funciona igual con la cámara trasera de un teléfono y con una cámara web:
 * `facingMode: 'environment'` es una preferencia, no una exigencia, así que un
 * portátil que solo tiene cámara frontal la usa sin fallar.
 */

export interface CapturaCamaraProps {
  /** Entrega la foto ya como archivo, listo para el mismo camino que subir uno. */
  onCaptura(archivo: File): void;
  onCerrar(): void;
}

export function CapturaCamara({ onCaptura, onCerrar }: CapturaCamaraProps): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lista, setLista] = useState(false);

  const detener = useCallback(() => {
    for (const pista of streamRef.current?.getTracks() ?? []) pista.stop();
    streamRef.current = null;
  }, []);

  useEffect(() => {
    let cancelado = false;

    async function abrir(): Promise<void> {
      if (navigator.mediaDevices?.getUserMedia === undefined) {
        setError('Este navegador no da acceso a la cámara. Sube la foto como archivo.');
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1920 } },
          audio: false,
        });

        // Si el panel se cerró mientras se pedía el permiso, la cámara tiene
        // que apagarse igual: dejar el piloto encendido asusta, y con razón.
        if (cancelado) {
          for (const pista of stream.getTracks()) pista.stop();
          return;
        }

        streamRef.current = stream;
        if (videoRef.current !== null) {
          videoRef.current.srcObject = stream;
          // No basta con tener el flujo: hasta que no llegan los metadatos,
          // `videoWidth` y `videoHeight` valen cero y la captura saldria como
          // un lienzo de 0x0. Se habilita el boton cuando hay medidas.
          videoRef.current.onloadedmetadata = () => setLista(true);
        }
      } catch (causa) {
        setError(motivo(causa));
      }
    }

    void abrir();

    return () => {
      cancelado = true;
      detener();
    };
  }, [detener]);

  function tomar(): void {
    const video = videoRef.current;
    if (video === null || !lista) return;

    if (video.videoWidth === 0 || video.videoHeight === 0) {
      setError('La cámara todavía no entrega imagen. Espera un momento e inténtalo otra vez.');
      return;
    }

    const lienzo = document.createElement('canvas');
    lienzo.width = video.videoWidth;
    lienzo.height = video.videoHeight;
    lienzo.getContext('2d')?.drawImage(video, 0, 0);

    // JPEG y no PNG: la foto de un pizarrón en PNG son varios megabytes y viaja
    // en base64 dentro de la petición. La calidad de 0,92 no pierde trazo.
    lienzo.toBlob(
      (blob) => {
        if (blob === null) {
          setError('No se pudo capturar la imagen.');
          return;
        }
        const sello = new Date().toISOString().slice(0, 19).replaceAll(':', '-');
        onCaptura(new File([blob], `captura-${sello}.jpg`, { type: 'image/jpeg' }));
      },
      'image/jpeg',
      0.92,
    );
  }

  return (
    <div className="camara" data-testid="camara">
      {error === null ? (
        <>
          <video
            ref={videoRef}
            className="camara-vista"
            autoPlay
            playsInline
            muted
            aria-label="Vista de la cámara"
          />
          <div className="camara-acciones">
            <button type="button" onClick={tomar} disabled={!lista} data-testid="tomar-foto">
              {lista ? 'Tomar foto' : 'Abriendo cámara…'}
            </button>
            <button type="button" className="secundario" onClick={onCerrar}>
              Cancelar
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="error" data-testid="error-camara">
            {error}
          </p>
          <button type="button" className="secundario" onClick={onCerrar}>
            Cerrar
          </button>
        </>
      )}
    </div>
  );
}

/**
 * El motivo, en palabras que digan qué hacer.
 *
 * «NotAllowedError» no le sirve a nadie: lo que hace falta saber es si el
 * permiso está denegado, si no hay cámara o si otra aplicación la tiene tomada.
 */
function motivo(causa: unknown): string {
  const nombre = causa instanceof Error ? causa.name : '';

  switch (nombre) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'No diste permiso para usar la cámara. Actívalo en el candado de la barra de direcciones.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No se encontró ninguna cámara en este equipo.';
    case 'NotReadableError':
      return 'La cámara está ocupada por otra aplicación.';
    default:
      return 'No se pudo abrir la cámara. Sube la foto como archivo.';
  }
}
