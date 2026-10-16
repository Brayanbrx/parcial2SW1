import type { GenerationIr } from '@uml/generation-ir';
import { generateSpringProjectFiles } from './project-generator.js';
import type { GeneratedSpringProject, GenerateSpringOptions } from './types.js';
import { createProjectZip } from './zip.js';

export * from './fingerprint.js';
export * from './types.js';
export * from './project-generator.js';
export * from './zip.js';
export * from './mobile-generator.js';

/** Genera el arbol de archivos y su ZIP sin escribir en el sistema de archivos. */
export async function generateSpringProject(
  ir: GenerationIr,
  options: GenerateSpringOptions = {},
): Promise<GeneratedSpringProject> {
  const files = await generateSpringProjectFiles(ir, options);
  const zip = await createProjectZip(files);
  return Object.freeze({
    artifactName: `${ir.project.artifactId}.zip`,
    ir,
    files,
    zip,
  });
}
