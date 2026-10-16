import { z } from 'zod';
import { VALIDATION_SEVERITIES, type ValidationSeverity } from './severity.js';

/**
 * Codigos del validador.
 *
 * La severidad de un codigo es fija: un mismo hallazgo no es error en un sitio y
 * aviso en otro. Por eso vive en la tabla de mas abajo y no en cada llamada.
 */

/** CA-017.1 — Error. Bloquea la generacion. */
export const ERROR_CODES = [
  'CLASS_WITHOUT_NAME',
  'INVALID_IDENTIFIER',
  'DUPLICATE_CLASS_NAME',
  'DUPLICATE_ATTRIBUTE_NAME',
  'UNSUPPORTED_TYPE',
  'RELATIONSHIP_TO_MISSING_CLASS',
  'MULTIPLE_PRIMARY_KEY_CANDIDATES',
  'COMPOSITE_PRIMARY_KEY',
  'DUPLICATE_RELATIONSHIP_WITHOUT_ROLE',
  'ROLE_NAME_COLLISION',
  'MANY_TO_MANY_RELATIONSHIP',
  'UNSUPPORTED_MULTIPLICITY',
  // Herencia. Las cuatro construcciones que el modelo relacional no puede
  // proyectar: una clase que se hereda a si misma, un ciclo, dos superclases
  // —Java solo tiene una— y un miembro que tapa al que ya venia de arriba.
  'SELF_GENERALIZATION',
  'INHERITANCE_CYCLE',
  'MULTIPLE_INHERITANCE',
  'INHERITED_MEMBER_COLLISION',
] as const;

/** CA-017.2 — Aviso. Permite generar. */
export const WARNING_CODES = [
  'PRIMARY_KEY_INFERRED',
  'PRIMARY_KEY_GENERATED',
  'NAME_NORMALIZED',
  'RESERVED_NAME_PREFIXED',
  'CLASS_WITHOUT_RELATIONSHIPS',
  'PRIMARY_KEY_INHERITED',
] as const;

/** Precondiciones de un comando. No describen el modelo, describen el lote. */
export const PRECONDITION_CODES = [
  'STALE_PROPOSAL',
  'WRITE_ACCESS_DENIED',
  'UNKNOWN_CLASS',
  'UNKNOWN_ATTRIBUTE',
  'UNKNOWN_RELATIONSHIP',
  'DUPLICATE_ID',
  'SELF_RELATIONSHIP',
] as const;

export const VALIDATION_CODES = [...ERROR_CODES, ...WARNING_CODES, ...PRECONDITION_CODES] as const;
export type ValidationCode = (typeof VALIDATION_CODES)[number];

const severityByCode = new Map<ValidationCode, ValidationSeverity>([
  ...ERROR_CODES.map((code) => [code, 'ERROR'] as const),
  ...WARNING_CODES.map((code) => [code, 'WARNING'] as const),
  ...PRECONDITION_CODES.map((code) => [code, 'ERROR'] as const),
]);

export function severityOf(code: ValidationCode): ValidationSeverity {
  const severity = severityByCode.get(code);
  if (severity === undefined) {
    throw new Error(`Codigo de validacion sin severidad declarada: ${code}`);
  }
  return severity;
}

export const validationIssueSchema = z.object({
  code: z.enum(VALIDATION_CODES),
  severity: z.enum(VALIDATION_SEVERITIES),
  /** Mensaje en el idioma del usuario. Dice que pasa, no como se llama el codigo. */
  message: z.string().min(1),
  /**
   * Como modelarlo de otra manera. Obligatorio cuando el hallazgo es una
   * construccion no soportada: «cada una de estas exclusiones esta declarada, no
   * omitida» (plan maestro 12).
   */
  suggestion: z.string().optional(),
  /** Identificadores de los elementos implicados, para que la interfaz los resalte. */
  elementIds: z.array(z.string()).default([]),
});
export type ValidationIssue = z.infer<typeof validationIssueSchema>;

export const validationResultSchema = z.object({
  issues: z.array(validationIssueSchema),
});
export type ValidationResult = z.infer<typeof validationResultSchema>;

export function hasErrors(issues: readonly ValidationIssue[]): boolean {
  return issues.some((issue) => issue.severity === 'ERROR');
}

export function errorsOf(issues: readonly ValidationIssue[]): ValidationIssue[] {
  return issues.filter((issue) => issue.severity === 'ERROR');
}

export function warningsOf(issues: readonly ValidationIssue[]): ValidationIssue[] {
  return issues.filter((issue) => issue.severity === 'WARNING');
}

/**
 * Identidad estable de un hallazgo.
 *
 * Sirve para responder «este error ya estaba antes del lote o lo introduce el
 * lote». Sin esa distincion, una pizarra que quedo invalida por una fusion
 * concurrente (CA-025.1) rechazaria todo lote posterior, incluido el que
 * arreglaria el problema.
 */
export function issueKey(issue: ValidationIssue): string {
  return `${issue.code}|${[...issue.elementIds].sort().join(',')}`;
}
