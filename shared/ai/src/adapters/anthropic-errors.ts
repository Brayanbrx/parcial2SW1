import Anthropic from '@anthropic-ai/sdk';
import { ProviderContractError, ProviderUnavailableError } from '../ports.js';

export function anthropicFailure(error: unknown): Error {
  if (error instanceof Anthropic.APIError && error.status !== undefined) {
    const status = error.status;
    if (status === 402 || status === 429) {
      return new ProviderUnavailableError(
        'anthropic',
        `anthropic: cuota o saldo no disponible (HTTP ${status}).`,
        { cause: error, quota: true },
      );
    }
    if (status < 500 && ![408, 409, 425].includes(status)) {
      return new ProviderContractError(
        'anthropic',
        `anthropic rechazo la peticion (HTTP ${status}). Revisa credenciales, modelo y parametros.`,
      );
    }
  }
  return new ProviderUnavailableError('anthropic', 'El proveedor no respondio.', { cause: error });
}
