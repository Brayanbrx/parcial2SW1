import { boardStateSchema, type BoardState } from '@uml/contracts';

export const umlId = (n: number) => `12345678-1234-4234-8234-${String(n).padStart(12, '0')}`;
export function uml251Fixture(): BoardState {
  const member = (n: number, name: string, type: string, extra = {}) => ({
    id: umlId(n),
    displayName: name,
    codeName: name,
    databaseName: name,
    type,
    ...extra,
  });
  const classifier = (n: number, name: string, extra = {}) => ({
    id: umlId(n),
    displayName: name,
    codeName: name,
    databaseName: name.toLowerCase(),
    attributes: [],
    ...extra,
  });
  const relation = (n: number, kind: string, source: number, target: number, extra = {}) => ({
    id: umlId(n),
    kind,
    sourceClassId: umlId(source),
    targetClassId: umlId(target),
    sourceMultiplicity: '1',
    targetMultiplicity: '1',
    ...extra,
  });
  return boardStateSchema.parse({
    semantic: {
      classes: [
        classifier(1, 'Factura', {
          attributes: [
            member(11, 'estado', 'Estado', { nullable: false }),
            member(12, 'etiquetas', 'String', {
              visibility: 'protected',
              isStatic: true,
              isDerived: true,
              isReadOnly: true,
              defaultValue: '"venta"',
              multiplicity: '2..5',
              nullable: false,
            }),
          ],
          operations: [
            {
              id: umlId(21),
              displayName: 'calcularTotal',
              returnType: 'Dinero',
              returnMultiplicity: '0..1',
              parameters: [
                {
                  id: umlId(31),
                  name: 'impuesto',
                  type: 'Decimal',
                  direction: 'inout',
                  multiplicity: '0..1',
                  defaultValue: '0',
                },
              ],
            },
            { id: umlId(22), displayName: 'crear', isStatic: true, returnType: 'Factura' },
          ],
        }),
        classifier(2, 'Facturable', {
          kind: 'INTERFACE',
          operations: [
            {
              id: umlId(23),
              displayName: 'calcularTotal',
              isAbstract: true,
              returnType: 'Dinero',
              returnMultiplicity: '0..1',
              parameters: [
                {
                  id: umlId(32),
                  name: 'impuesto',
                  type: 'Decimal',
                  direction: 'inout',
                  multiplicity: '0..1',
                  defaultValue: '0',
                },
              ],
            },
          ],
        }),
        classifier(3, 'Estado', { kind: 'ENUMERATION', literals: ['PENDIENTE', 'PAGADO'] }),
        classifier(4, 'Dinero', {
          kind: 'DATA_TYPE',
          attributes: [member(13, 'importe', 'Decimal')],
        }),
        classifier(5, 'Documento', { isAbstract: true }),
        classifier(6, 'Detalle'),
      ],
      relationships: [
        relation(41, 'REALIZATION', 1, 2),
        relation(42, 'DEPENDENCY', 1, 4, { name: 'utiliza' }),
        relation(43, 'GENERALIZATION', 1, 5),
        relation(44, 'COMPOSITION', 1, 6, {
          sourceMultiplicity: '0..1',
          targetMultiplicity: '2..5',
          name: 'contiene',
          targetNavigability: 'navigable',
          sourceNavigability: 'nonNavigable',
          targetRoleName: 'detalles',
        }),
      ],
    },
    layout: { positions: { [umlId(1)]: { x: 40, y: 80 } } },
  });
}
