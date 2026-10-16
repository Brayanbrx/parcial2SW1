import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Handlebars from 'handlebars';

const TEMPLATE_NAMES = [
  'pom.xml',
  'application.java',
  'entity.java',
  'dto.java',
  'repository.java',
  'service.java',
  'controller.java',
  'resource-not-found.java',
  'api-error.java',
  'global-exception-handler.java',
  'application.properties',
  'Dockerfile',
  'compose.yaml',
  'env.example',
  'README.md',
  'web-config.java',
] as const;

export type TemplateName = (typeof TEMPLATE_NAMES)[number];

export function defaultTemplateDirectory(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../../../templates/spring');
}

/** Carga cada plantilla una sola vez por instancia y falla con contexto util. */
export class TemplateRenderer {
  private readonly compiled = new Map<TemplateName, Handlebars.TemplateDelegate>();

  public constructor(private readonly directory = defaultTemplateDirectory()) {}

  public async render(name: TemplateName, context: object): Promise<string> {
    if (!TEMPLATE_NAMES.includes(name)) throw new Error(`Plantilla no permitida: ${name}`);
    let template = this.compiled.get(name);
    if (template === undefined) {
      const path = resolve(this.directory, `${name}.hbs`);
      let source: string;
      try {
        source = await readFile(path, 'utf8');
      } catch (error) {
        throw new Error(`No se pudo cargar la plantilla ${path}.`, { cause: error });
      }
      template = Handlebars.compile(source, { strict: true, noEscape: false });
      this.compiled.set(name, template);
    }

    return `${template(context).trimEnd()}\n`;
  }
}
