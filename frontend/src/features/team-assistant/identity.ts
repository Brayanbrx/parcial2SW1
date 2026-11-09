/**
 * Identidad visual de quienes participan en la conversación del equipo.
 *
 * Cada persona conserva su color de presencia cuando está en la pizarra; si no
 * lo está, se deriva uno estable de su identificador para que el mismo autor se
 * reconozca de un vistazo en todo el historial. La IA tiene identidad propia:
 * es un integrante más del equipo, pero nunca una presencia Yjs (plan §12).
 */

/** Misma paleta que la presencia del editor (`useBoardDocument`). */
const PALETA = [
  '#2563eb',
  '#16a34a',
  '#db2777',
  '#ea580c',
  '#7c3aed',
  '#0891b2',
  '#ca8a04',
  '#dc2626',
];

export const IA_EQUIPO = {
  nombre: 'IA del equipo',
  rol: 'Mentora y moderadora',
  iniciales: 'IA',
} as const;

export function colorEstable(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return PALETA[Math.abs(hash) % PALETA.length] as string;
}

export function iniciales(nombre: string): string {
  const partes = nombre.trim().split(/\s+/).filter(Boolean);
  if (partes.length >= 2) return `${partes[0]![0]}${partes[1]![0]}`.toUpperCase();
  return (partes[0] ?? '?').slice(0, 2).toUpperCase();
}

export type EstadoIa = 'disponible' | 'pensando' | 'en-cola' | 'pausada' | 'sin-conexion';

export interface ActividadIa {
  readonly estado: EstadoIa;
  /** Frase corta para la barra superior y lectores de pantalla. */
  readonly detalle: string;
}

export const ACTIVIDAD_INICIAL: ActividadIa = { estado: 'disponible', detalle: 'Disponible' };
