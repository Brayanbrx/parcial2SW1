import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fixture } from '@uml/fixtures';
import { buildGenerationIr } from '@uml/generation-ir';
import { generateSpringProject, generateMobileProject } from '@uml/generator-backend';
import { serializeToEnterpriseArchitect } from '@uml/xmi';

const model = fixture('T01').model;
const generated = await (
  process.argv.includes('--mobile') ? generateMobileProject : generateSpringProject
)(
  buildGenerationIr({
    projectName: 'Sistema de Ventas',
    snapshotVersion: 1,
    model,
  }),
);
const output = resolve('generated-output');
await mkdir(output, { recursive: true });
const root = await mkdtemp(resolve(output, 'demo-ventas-'));
const projectRoot = process.argv.includes('--mobile') ? root : resolve(root, 'backend');
for (const file of generated.files) {
  const target = resolve(projectRoot, file.path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, file.content, 'utf8');
}
await writeFile(resolve(root, generated.artifactName), generated.zip);
await writeFile(resolve(root, 'modelo.json'), JSON.stringify(model, null, 2), 'utf8');
await writeFile(
  resolve(root, 'modelo.xmi'),
  serializeToEnterpriseArchitect(model, { modelName: 'Sistema de Ventas' }),
  'utf8',
);
process.stdout.write(
  `Backend: ${resolve(root, 'backend')}\nZIP: ${resolve(root, generated.artifactName)}\nDiagrama: ${resolve(root, 'modelo.xmi')}\n`,
);
