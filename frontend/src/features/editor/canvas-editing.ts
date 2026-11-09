import { createContext, useContext } from 'react';
import type { CommandBody } from './commands.js';

/**
 * Lo que una tarjeta necesita para editarse sobre el propio diagrama.
 *
 * Va por contexto y no en `data` del nodo: React Flow reconstruye los nodos a
 * menudo, y una función nueva en cada `data` volvería a medir todas las
 * tarjetas. Sin proveedor (vista previa, exportación) la tarjeta es de solo
 * lectura.
 */
export interface CanvasEditing {
  run(...commands: readonly CommandBody[]): void;
}

export const CanvasEditingContext = createContext<CanvasEditing | null>(null);

export function useCanvasEditing(): CanvasEditing | null {
  return useContext(CanvasEditingContext);
}
