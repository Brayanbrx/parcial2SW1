/** Frecuencia que usa Whisper; enviar más solo agranda la subida. */
export const WHISPER_SAMPLE_RATE = 16_000;

/** PCM mono en [-1, 1] → WAV PCM de 16 bits. Función pura: se prueba sin navegador. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const dataBytes = samples.length * 2;
  const view = new DataView(new ArrayBuffer(44 + dataBytes));
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true); // tamaño del bloque fmt
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // bytes por segundo
  view.setUint16(32, 2, true); // bytes por muestra
  view.setUint16(34, 16, true); // bits por muestra
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(44 + i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return new Uint8Array(view.buffer);
}

/**
 * Lo que graba el navegador (webm/opus en Chrome y Edge) → WAV de 16 kHz mono.
 * Whisper y Ollama no decodifican opus; el navegador sí, así el servidor no
 * necesita ffmpeg.
 */
export async function recordingToWav(
  recording: Blob,
  sampleRate = WHISPER_SAMPLE_RATE,
): Promise<Uint8Array> {
  // decodeAudioData de un contexto sin conexión ya entrega a su frecuencia.
  const decoded = await new OfflineAudioContext(1, 1, sampleRate).decodeAudioData(
    await recording.arrayBuffer(),
  );
  const mono = new OfflineAudioContext(1, Math.max(1, decoded.length), sampleRate);
  const source = mono.createBufferSource();
  source.buffer = decoded;
  source.connect(mono.destination);
  source.start();
  const rendered = await mono.startRendering();
  return encodeWav(rendered.getChannelData(0), sampleRate);
}
