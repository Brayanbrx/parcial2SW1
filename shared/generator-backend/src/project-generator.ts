import type { GenerationIr, IrEntity } from '@uml/generation-ir';
import { TemplateRenderer } from './template-renderer.js';
import type { GeneratedFile, GenerateSpringOptions } from './types.js';
import { createEntityView, createProjectView, resolvePackageImports } from './view-model.js';
import {
  clientGuide,
  dtoContract,
  postmanCollection,
  postmanEnvironment,
} from './client-artifacts.js';

export const SPRING_BOOT_VERSION = '4.1.1' as const;
export const SPRINGDOC_VERSION = '3.1.0' as const;
export const GENERATED_BACKEND_VERSION = '0.0.1-SNAPSHOT' as const;

export async function generateSpringProjectFiles(
  ir: GenerationIr,
  options: GenerateSpringOptions = {},
): Promise<readonly GeneratedFile[]> {
  const renderer = new TemplateRenderer(options.templateDirectory);
  const projectView = {
    mobileRuntime: options.mobileRuntime === true,
    ...createProjectView(ir),
    springBootVersion: SPRING_BOOT_VERSION,
    springdocVersion: SPRINGDOC_VERSION,
    backendVersion: GENERATED_BACKEND_VERSION,
    databaseUrlProperty: `\${DATABASE_URL:jdbc:postgresql://localhost:5433/${ir.project.databaseName}}`,
    composeDatabaseName: `\${DB_NAME:-${ir.project.databaseName}}`,
  };
  const javaRoot = `src/main/java/${ir.project.packagePath}`;

  const files: GeneratedFile[] = [
    file('pom.xml', await renderer.render('pom.xml', projectView)),
    file(
      `${javaRoot}/${ir.project.applicationClassName}.java`,
      await renderer.render('application.java', projectView),
    ),
    file(
      `${javaRoot}/exception/ResourceNotFoundException.java`,
      await renderer.render('resource-not-found.java', projectView),
    ),
    file(
      `${javaRoot}/exception/ApiError.java`,
      await renderer.render('api-error.java', projectView),
    ),
    file(
      `${javaRoot}/exception/GlobalExceptionHandler.java`,
      await renderer.render('global-exception-handler.java', projectView),
    ),
    file(
      'src/main/resources/application.properties',
      await renderer.render('application.properties', projectView),
    ),
    file('Dockerfile', await renderer.render('Dockerfile', projectView)),
    file('compose.yaml', await renderer.render('compose.yaml', projectView)),
    file('.env.example', await renderer.render('env.example', projectView)),
    file('README.md', await renderer.render('README.md', projectView)),
    file(
      `${javaRoot}/config/WebConfig.java`,
      await renderer.render('web-config.java', projectView),
    ),
    file('.gitignore', '.env\ntarget/\n.idea/\n*.iml\n'),
    file('.dockerignore', '.env\n.git\ntarget\n.idea\n'),
  ];

  for (const entity of ir.entities) {
    files.push(
      ...(await renderEntity(renderer, javaRoot, ir, entity, options.mobileRuntime === true)),
    );
  }

  files.push(file('postman/collection.json', postmanCollection(ir)));
  files.push(file('postman/local.environment.json', postmanEnvironment(ir)));
  files.push(file('docs/dto-contract.json', dtoContract(ir)));
  files.push(file('docs/flutter-api.md', clientGuide(ir)));
  files.push(file('generation-manifest.json', generationManifest(ir, files)));

  return Object.freeze(
    files
      .sort((left, right) => left.path.localeCompare(right.path, 'en'))
      .map((item) => Object.freeze(item)),
  );
}

async function renderEntity(
  renderer: TemplateRenderer,
  javaRoot: string,
  ir: GenerationIr,
  entity: IrEntity,
  mobileRuntime: boolean,
): Promise<GeneratedFile[]> {
  const view = { ...resolvePackageImports(createEntityView(ir, entity)), mobileRuntime };
  return [
    file(`${javaRoot}/model/${entity.className}.java`, await renderer.render('entity.java', view)),
    file(`${javaRoot}/dto/${entity.dtoName}.java`, await renderer.render('dto.java', view)),
    file(
      `${javaRoot}/repository/${entity.repositoryName}.java`,
      await renderer.render('repository.java', view),
    ),
    file(
      `${javaRoot}/service/${entity.serviceName}.java`,
      await renderer.render('service.java', view),
    ),
    file(
      `${javaRoot}/controller/${entity.controllerName}.java`,
      await renderer.render('controller.java', view),
    ),
  ];
}

function generationManifest(ir: GenerationIr, existingFiles: readonly GeneratedFile[]): string {
  return json({
    generator: '@uml/generator-backend',
    generatorVersion: GENERATED_BACKEND_VERSION,
    irVersion: ir.irVersion,
    snapshotVersion: ir.snapshotVersion,
    project: ir.project,
    entities: ir.entities.map((entity) => ({
      className: entity.className,
      tableName: entity.tableName,
      resourcePath: `/api/${entity.resourcePath}`,
    })),
    files: [...existingFiles.map((item) => item.path), 'generation-manifest.json'].sort((a, b) =>
      a.localeCompare(b, 'en'),
    ),
  });
}

function file(path: string, content: string): GeneratedFile {
  return { path, content: content.replaceAll('\r\n', '\n') };
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
