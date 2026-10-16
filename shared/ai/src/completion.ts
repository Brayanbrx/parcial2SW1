import { ProviderContractError } from './ports.js';

/** HTTP 200 y JSON válido no garantizan que haya terminado la respuesta. */
export function requireCompleteResponse(
  provider: string,
  reason: string | null | undefined,
  expected: string,
): void {
  if (reason === null || reason === undefined || reason === expected) return;
  throw new ProviderContractError(
    provider,
    `La respuesta no se completo (${reason}). No se aplicara una propuesta parcial. Acorta la solicitud o revisa el limite de salida.`,
  );
}
