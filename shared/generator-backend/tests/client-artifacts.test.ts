import { describe, expect, it } from 'vitest';
import { fixture, GENERABLE_FIXTURE_IDS } from '@uml/fixtures';
import { buildGenerationIr } from '@uml/generation-ir';
import { generateSpringProjectFiles } from '@uml/generator-backend';

interface Collection {
  variable: { key: string; value: string }[];
  info: { description: string };
  item: { request: { method: string; url: string; body?: { raw: string } }; event: unknown[] }[];
}

describe('contrato de clientes del backend generado', () => {
  it.each(GENERABLE_FIXTURE_IDS)(
    '%s: Postman crea dependencias antes y borra despues de sus hijos',
    async (id) => {
      const ir = buildGenerationIr({
        projectName: 'Gestion',
        snapshotVersion: 1,
        model: fixture(id).model,
      });
      const files = await generateSpringProjectFiles(ir);
      const collection = JSON.parse(
        files.find((f) => f.path === 'postman/collection.json')!.content,
      ) as Collection;
      const variables = new Map(collection.variable.map((v) => [v.key, v.value]));
      const substitute = (s: string) =>
        s.replace(/\{\{(\w+)\}\}/g, (_, key: string) => variables.get(key)!);
      const created = new Set<string>();
      const bodies = new Map<string, Record<string, unknown>>();
      for (const item of collection.item.filter((i) => i.request.method === 'POST')) {
        const entity = ir.entities.find(
          (e) => item.request.url === `{{baseUrl}}/api/${e.resourcePath}`,
        )!;
        const body = JSON.parse(substitute(item.request.body!.raw)) as Record<string, unknown>;
        for (const link of entity.relationships) {
          if (link.optional) {
            expect(body[link.queryParameterName]).toBeNull();
            continue;
          }
          expect(created.has(link.targetEntityId)).toBe(true);
          const target = ir.entities.find((e) => e.sourceClassId === link.targetEntityId)!;
          expect(body[link.queryParameterName]).toEqual(
            bodies.get(target.sourceClassId)![target.primaryKey.fieldName],
          );
        }
        expect(item.event).toHaveLength(1);
        bodies.set(entity.sourceClassId, body);
        created.add(entity.sourceClassId);
      }
      const creates = collection.item
        .filter((i) => i.request.method === 'POST')
        .map((i) => i.request.url);
      const deletes = collection.item
        .filter((i) => i.request.method === 'DELETE')
        .map((i) => i.request.url.replace(/\/\{\{\w+\}\}$/, ''));
      expect(deletes).toEqual([...creates].reverse());
      expect(collection.info.description).not.toContain('ciclicas');
    },
  );

  it.each(['Integer', 'Long', 'String'] as const)(
    'las claves %s y sus referencias mantienen el tipo JSON',
    async (type) => {
      const original = fixture('T01').model;
      const model = {
        ...original,
        classes: original.classes.map((c) => ({
          ...c,
          attributes: c.attributes.map((a) => (a.primaryKey ? { ...a, type } : a)),
        })),
      };
      const ir = buildGenerationIr({ projectName: 'Gestion', snapshotVersion: 1, model });
      const files = await generateSpringProjectFiles(ir);
      const collection = JSON.parse(
        files.find((f) => f.path === 'postman/collection.json')!.content,
      ) as Collection;
      const variables = new Map(collection.variable.map((v) => [v.key, v.value]));
      for (const item of collection.item.filter((i) => i.request.method === 'POST')) {
        const entity = ir.entities.find((e) =>
          item.request.url.endsWith(`/api/${e.resourcePath}`),
        )!;
        const body = JSON.parse(
          item.request.body!.raw.replace(/\{\{(\w+)\}\}/g, (_, key: string) => variables.get(key)!),
        ) as Record<string, unknown>;
        expect(typeof body[entity.primaryKey.fieldName]).toBe(
          type === 'String' ? 'string' : 'number',
        );
        for (const link of entity.relationships.filter((r) => !r.optional))
          expect(typeof body[link.queryParameterName]).toBe(
            type === 'String' ? 'string' : 'number',
          );
      }
    },
  );

  it('expone el contrato DTO de herencia, nulabilidad y claves foraneas, y configuracion externa', async () => {
    const files = await generateSpringProjectFiles(
      buildGenerationIr({
        projectName: 'Gestion',
        snapshotVersion: 1,
        model: fixture('T08').model,
      }),
    );
    const get = (path: string) => files.find((f) => f.path.endsWith(path))!.content;
    const contract = JSON.parse(get('docs/dto-contract.json')) as {
      resources: { className: string; fields: { name: string; references?: string }[] }[];
    };
    const docente = contract.resources.find((e) => e.className === 'Docente')!;
    expect(docente.fields.some((f) => f.name === 'nombre')).toBe(true);
    expect(docente.fields.find((f) => f.name === 'departamentoId')?.references).toBe(
      'Departamento',
    );
    expect(get('compose.yaml')).toContain('127.0.0.1:${DB_PORT:-5433}:5432');
    expect(get('application.properties')).toContain('${PORT:${APP_PORT:8081}}');
    expect(get('application.properties')).toContain('${DATABASE_URL:');
    expect(get('application.properties')).toContain('${DB_USER:');
    expect(get('application.properties')).toContain('${DB_PASSWORD:');
    expect(get('Dockerfile')).toContain('USER app');
    expect(get('.dockerignore')).toContain('.env');
  });
});
