import { readFileSync } from 'node:fs';
import { parseXmi, xmiToProposal } from '@uml/xmi';
import { describe, expect, it } from 'vitest';

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

describe('clases asociativas como entidades intermedias', () => {
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

  it('resuelve UML estándar, conserva los roles y cruza los límites hacia la entidad intermedia', () => {
    const model = parseXmi(wrap(classes + association));
    expect(model.relationships).toEqual([
      expect.objectContaining({
        sourceName: 'Estudiante',
        targetName: 'Inscripcion',
        sourceRole: 'estudiante',
        sourceMultiplicity: '1',
        targetMultiplicity: '1..*',
      }),
      expect.objectContaining({
        sourceName: 'Curso',
        targetName: 'Inscripcion',
        sourceRole: 'curso',
        sourceMultiplicity: '1',
        targetMultiplicity: '0..1',
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
    expect(model.relationships).toHaveLength(2);
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
    expect(model.relationships.every((r) => r.targetName === 'Inscripcion_2')).toBe(true);
  });

  it('distingue los dos roles de una asociación reflexiva', () => {
    const model = parseXmi(wrap(classes + association.replace('type="B"', 'type="A"')));
    expect(model.relationships).toHaveLength(2);
    expect(new Set(model.relationships.map((r) => r.targetRole)).size).toBe(2);
  });
});
