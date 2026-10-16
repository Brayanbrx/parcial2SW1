import type { GenerationIr } from '@uml/generation-ir';

export interface GeneratedFile {
  /** Ruta POSIX relativa a la raiz del proyecto generado. */
  readonly path: string;
  readonly content: string;
}

export interface GenerateSpringOptions {
  /** Includes authenticated mobile synchronization endpoints in the paired bundle. */
  readonly mobileRuntime?: boolean;
  /** Permite inyectar plantillas en pruebas o despliegues empaquetados. */
  readonly templateDirectory?: string;
}

export interface GeneratedSpringProject {
  readonly artifactName: string;
  readonly ir: GenerationIr;
  readonly files: readonly GeneratedFile[];
  readonly zip: Buffer;
}
