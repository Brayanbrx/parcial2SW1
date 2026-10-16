import { ProviderContractError, ProviderUnavailableError, type PortUsage } from './ports.js';

export interface ChainEntry<P> {
  port: P;
  key: string;
}

/** Una sola llamada a la vez. El plazo total y la cuota pertenecen a la cadena. */
export class FallbackChain {
  private readonly cooldowns = new Map<
    string,
    { until: number; error: ProviderUnavailableError }
  >();
  public constructor(
    private readonly usageLog: PortUsage[],
    private readonly logUsage: boolean,
    private readonly cooldownMs: number,
  ) {}

  public async run<P, T extends { usage?: PortUsage }>(
    entries: readonly ChainEntry<P>[],
    invoke: (port: P, signal: AbortSignal) => Promise<T>,
    timeoutMs: number,
    caller?: AbortSignal,
  ): Promise<T> {
    const deadline = AbortSignal.timeout(timeoutMs);
    const signal = caller ? AbortSignal.any([caller, deadline]) : deadline;
    const failures: Error[] = [];
    for (const entry of entries) {
      caller?.throwIfAborted();
      if (deadline.aborted) break;
      const cooldown = this.cooldowns.get(entry.key);
      if (cooldown && cooldown.until > Date.now()) {
        failures.push(cooldown.error);
        continue;
      }
      this.cooldowns.delete(entry.key);
      try {
        const result = await invoke(entry.port, signal);
        caller?.throwIfAborted();
        if (deadline.aborted) break;
        if (result.usage && this.logUsage) {
          this.usageLog.push(result.usage);
          if (this.usageLog.length > 200) this.usageLog.splice(0, this.usageLog.length - 200);
        }
        return result;
      } catch (error) {
        caller?.throwIfAborted();
        if (deadline.aborted) break;
        if (!(error instanceof ProviderUnavailableError)) {
          if (error instanceof ProviderContractError && failures.length) {
            throw new ProviderContractError(
              error.provider,
              `${error.message} (se recurrio al respaldo porque el proveedor primario fallo: ${failures.map((f) => f.message).join('; ')})`,
              error.raw,
            );
          }
          throw error;
        }
        failures.push(error);
        if (error.quota) {
          this.cooldowns.set(entry.key, {
            error,
            until:
              Date.now() + Math.min(86400000, Math.max(this.cooldownMs, error.retryAfterMs ?? 0)),
          });
        }
      }
    }
    throw new ProviderUnavailableError(
      'cadena',
      `${deadline.aborted ? 'Se agoto el plazo total de IA.' : 'Ningun proveedor de la cadena esta disponible.'} ${failures.map((f) => f.message).join('; ')}`,
      { cause: failures.at(-1) },
    );
  }
}
