/** Severidad de un hallazgo del validador (CA-017.1 error, CA-017.2 aviso). */
export const VALIDATION_SEVERITIES = ['ERROR', 'WARNING'] as const;
export type ValidationSeverity = (typeof VALIDATION_SEVERITIES)[number];
