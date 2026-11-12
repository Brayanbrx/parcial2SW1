import { readFileSync } from 'node:fs';
import { emptyBoardState } from '@uml/contracts';
import { applyBatch, validateGenerationModel, validateUmlModel } from '@uml/domain-core';
import {
  parseXmi,
  serializeToEnterpriseArchitect,
  serializeToXmi,
  serializeToXmi251,
  xmiToBatch,
  xmiToProposal,
} from '@uml/xmi';
import { describe, expect, it } from 'vitest';
import { umlId } from '../../domain-core/tests/uml251-fixture.js';

const real = new TextDecoder('windows-1252').decode(
  readFileSync(new URL('./fixtures/ea-association-class.xmi', import.meta.url)),
);
const wrap = (body: string) =>
  `<xmi:XMI xmlns:xmi="x" xmlns:uml="u"><uml:Model name="Modelo">${body}</uml:Model></xmi:XMI>`;
const association = `<packagedElement xmi:type="uml:AssociationClass" xmi:id="AC" name="Inscripcion">
  <ownedAttribute xmi:id="fecha" name="fecha" type="Date"/>
  <ownedEnd xmi:id="e1" name="estudiante" type="A"><lowerValue value="0"/><upperValue value="1"/></ownedEnd>
  <ownedEnd xmi:id="e2" name="curso" type="B"><lowerValue value="1"/><upperValue value="*"/></ownedEnd>
</packagedElement>`;
const classes = `<packagedElement xmi:type="uml:Class" xmi:id="A" name="Estudiante"/><packagedElement xmi:type="uml:Class" xmi:id="B" name="Curso"/>`;

describe('clases de asociación en XMI', () => {
  it('PracticaProbar: recupera Inscripcion, sus cuatro tipos y sus tres enlaces', () => {
    const model = parseXmi(real);
    expect(model.classes.filter((c) => c.name === 'Inscripcion')).toHaveLength(1);
    const middle = model.classes.find((c) => c.name === 'Inscripcion')!;
    expect(middle.xmiId).toBe('7febb9bf-1f3f-4e76-9857-5f07c7628a03');
    expect(middle.attributes.map((a) => [a.name, a.type])).toEqual([
      ['fecha', 'Date'],
      ['estado', 'String'],
      ['notaFinal', 'Decimal'],
      ['idInscripcion', 'Integer'],
    ]);
    expect(model.relationships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceName: 'Estudiante',
          targetName: 'Inscripcion',
          sourceMultiplicity: '1',
          targetMultiplicity: '0..*',
        }),
        expect.objectContaining({
          sourceName: 'Curso',
          targetName: 'Inscripcion',
          sourceMultiplicity: '1',
          targetMultiplicity: '0..*',
        }),
        expect.objectContaining({
          sourceName: 'Inscripcion',
          targetName: 'Calificacion',
          kind: 'COMPOSITION',
          sourceMultiplicity: '1',
          targetMultiplicity: '0..*',
        }),
      ]),
    );
    expect(
      model.relationships.some(
        (r) => [r.sourceName, r.targetName].sort().join() === 'Curso,Estudiante',
      ),
    ).toBe(false);
    expect(model.classes.some((c) => c.name.startsWith('ProxyConnector'))).toBe(false);
    expect(model.warnings.some((w) => /no se pudieron|no esta en|no declara/.test(w.reason))).toBe(
      false,
    );
    expect(parseXmi(real)).toEqual(model);
    const proposal = xmiToProposal(model, {
      mode: 'ADD',
      current: { classes: [], relationships: [] },
    });
    expect(
      proposal.operations.filter(
        (o) => o.op === 'CREATE_CLASS' && o['className'] === 'Inscripcion',
      ),
    ).toHaveLength(1);
  });

  it('resuelve UML estándar y conserva los roles y multiplicidades en sus extremos', () => {
    const model = parseXmi(wrap(classes + association));
    expect(model.relationships).toEqual([
      expect.objectContaining({
        sourceName: 'Estudiante',
        targetName: 'Curso',
        associationClassXmiId: 'AC',
        sourceRole: 'estudiante',
        targetRole: 'curso',
        sourceMultiplicity: '0..1',
        targetMultiplicity: '1..*',
      }),
    ]);
  });

  it('resuelve memberEnd declarados dentro de clases participantes', () => {
    const body = classes.replace(
      'name="Estudiante"/>',
      `name="Estudiante"><ownedAttribute xmi:id="e2" association="AC" type="B"/></packagedElement>`,
    );
    const ac = association
      .replace(/<ownedEnd xmi:id="e2"[^]+?<\/ownedEnd>/, '')
      .replace(
        '</packagedElement>',
        '<memberEnd xmi:idref="e1"/><memberEnd xmi:idref="e2"/></packagedElement>',
      );
    const model = parseXmi(wrap(body + ac));
    expect(model.relationships).toHaveLength(1);
    expect(model.classes.find((c) => c.name === 'Estudiante')?.attributes).toEqual([]);
  });

  it('conserva atributos y avisa si falta un participante, sin inventar enlaces', () => {
    const model = parseXmi(wrap(association + classes.replace('xmi:id="B"', 'xmi:id="Falta"')));
    expect(model.classes.find((c) => c.name === 'Inscripcion')?.attributes).toHaveLength(1);
    expect(model.relationships).toEqual([]);
    expect(model.warnings).toContainEqual(
      expect.objectContaining({ reason: expect.stringContaining('no se pudieron resolver') }),
    );
  });

  it('no acepta tres memberEnd aunque solo pueda resolver dos', () => {
    const ac = association.replace(
      '</packagedElement>',
      '<memberEnd xmi:idref="e1"/><memberEnd xmi:idref="e2"/><memberEnd xmi:idref="missing"/></packagedElement>',
    );
    expect(parseXmi(wrap(classes + ac)).relationships).toEqual([]);
  });

  it('no fusiona una clase homónima con contenido y mantiene referencias por ID', () => {
    const duplicate =
      '<packagedElement xmi:type="uml:Class" xmi:id="Other" name="Inscripcion"><ownedAttribute name="detalle" type="String"/></packagedElement>';
    const model = parseXmi(wrap(classes + duplicate + association));
    expect(model.classes.find((c) => c.name === 'Inscripcion')?.attributes[0]?.name).toBe(
      'detalle',
    );
    expect(model.classes.find((c) => c.name === 'Inscripcion_2')?.attributes[0]?.name).toBe(
      'fecha',
    );
    expect(model.relationships[0]?.associationClassXmiId).toBe('AC');
    expect(model.classes.find((c) => c.xmiId === 'AC')?.name).toBe('Inscripcion_2');
  });

  it('conserva una clase homónima vacía de otro paquete en XMI estándar', () => {
    const otherPackage = `<packagedElement xmi:type="uml:Package" xmi:id="P" name="Archivo">
      <packagedElement xmi:type="uml:Class" xmi:id="Other" name="Inscripcion"/>
    </packagedElement>`;
    const model = parseXmi(wrap(classes + association + otherPackage));
    expect(model.classes.find((c) => c.xmiId === 'Other')).toMatchObject({
      name: 'Inscripcion_2',
      attributes: [],
    });
    expect(model.relationships[0]?.associationClassXmiId).toBe('AC');
  });

  it('distingue los dos roles de una asociación reflexiva', () => {
    const model = parseXmi(wrap(classes + association.replace('type="B"', 'type="A"')));
    expect(model.relationships).toEqual([
      expect.objectContaining({
        sourceName: 'Estudiante',
        targetName: 'Estudiante',
        sourceRole: 'estudiante',
        targetRole: 'curso',
      }),
    ]);
  });

  it('conserva la orientación del conector de EA cuando exporta un vínculo duplicado como asociación ordinaria', () => {
    const empty = emptyBoardState();
    const batch = xmiToBatch(parseXmi(wrap(classes + association)), {
      mode: 'REPLACE',
      current: empty.semantic,
      actorId: umlId(100),
    }).batch;
    const input = applyBatch(empty, batch);
    if (!input.applied) throw new Error('No se importó el diagrama de prueba');
    const original = input.state.semantic.relationships[0]!;
    const fallback = {
      ...original,
      id: umlId(105),
      sourceRoleName: 'origen',
      targetRoleName: 'destino',
    };
    input.state.semantic.relationships.push(fallback);

    const exported = serializeToEnterpriseArchitect(input.state.semantic, {
      modelName: 'Inscripciones',
    });
    const roundTrip = parseXmi(exported);
    expect(roundTrip.relationships.find((r) => r.xmiId === fallback.id)).toMatchObject({
      sourceXmiId: fallback.sourceClassId,
      targetXmiId: fallback.targetClassId,
      sourceRole: 'origen',
      targetRole: 'destino',
    });
    expect(
      roundTrip.relationships.filter((r) => r.associationClassXmiId !== undefined),
    ).toHaveLength(1);
  });

  it.each([serializeToXmi251, serializeToXmi, serializeToEnterpriseArchitect])(
    'conserva la clase de asociación al exportar y volver a importar con $name',
    (serialize) => {
      const empty = emptyBoardState();
      const options = { mode: 'REPLACE', current: empty.semantic, actorId: umlId(100) } as const;
      const input = applyBatch(
        empty,
        xmiToBatch(parseXmi(wrap(classes + association)), options).batch,
      );
      if (!input.applied) throw new Error('No se importó el diagrama de prueba');
      const linked = input.state.semantic.relationships[0]!;
      expect(linked.associationClassId).toBe(
        input.state.semantic.classes.find((c) => c.displayName === 'Inscripcion')?.id,
      );
      expect(validateUmlModel(input.state.semantic)).toEqual([]);
      expect(validateGenerationModel(input.state.semantic)).toContainEqual(
        expect.objectContaining({
          code: 'GENERATION_UNSUPPORTED_UML',
          elementIds: [linked.id, linked.associationClassId],
        }),
      );
      linked.name = 'nombre anterior';
      linked.sourceNavigability = 'nonNavigable';
      const xml = serialize(input.state.semantic, { modelName: 'Inscripciones' });
      expect(xml).toContain('xmi:type="uml:AssociationClass"');
      expect(xml).not.toContain('xmi:type="uml:Association"');
      const imported = parseXmi(xml);
      expect(imported.warnings).toEqual([]);
      const result = applyBatch(empty, xmiToBatch(imported, options).batch);
      if (!result.applied) throw new Error('No se reimportó el diagrama exportado');
      expect(result.state.semantic).toEqual(input.state.semantic);
    },
  );
});
