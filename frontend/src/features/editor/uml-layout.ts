import {
  attributeNotation,
  operationNotation,
  type BoardState,
  type Position,
  type Size,
  type UmlClass,
  type UmlRelationship,
} from '@uml/contracts';

/** Default dimensions keep all compartments visible, including long operation signatures. */
export function classifierSize(
  c: Pick<UmlClass, 'displayName' | 'attributes' | 'operations' | 'literals' | 'kind'>,
): Size {
  const operations = c.operations ?? [];
  const literals = c.literals ?? [];
  const lines = [
    c.displayName,
    ...c.attributes.map((a) => attributeNotation(a, { hideScalarMultiplicity: true })),
    ...operations.map(operationNotation),
    ...literals,
  ];
  return {
    width: Math.max(240, Math.min(760, Math.max(...lines.map((line) => line.length)) * 7 + 32)),
    height: Math.max(
      80,
      44 +
        (c.kind && c.kind !== 'CLASS' ? 24 : 0) +
        (c.attributes.length + operations.length + literals.length) * 22 +
        (operations.length ? 12 : 0) +
        (c.kind === 'ENUMERATION' ? 12 : 0),
    ),
  };
}

export function associationClassPosition(
  state: BoardState,
  relationship: UmlRelationship,
  { width, height }: Size,
): Position {
  const boxes = state.semantic.classes.map((c) => ({
    id: c.id,
    ...(state.layout.positions[c.id] ?? { x: 0, y: 0 }),
    ...(state.layout.sizes[c.id] ?? classifierSize(c)),
  }));
  const source = boxes.find((box) => box.id === relationship.sourceClassId);
  const target = boxes.find((box) => box.id === relationship.targetClassId);
  if (!source || !target) return { x: 80, y: 80 };

  const sx = source.x + source.width / 2;
  const sy = source.y + source.height / 2;
  const tx = target.x + target.width / 2;
  const ty = target.y + target.height / 2;
  const below = Math.abs(tx - sx) >= Math.abs(ty - sy);
  const loops = state.semantic.relationships.filter(
    (r) => r.sourceClassId === source.id && r.targetClassId === source.id,
  ).length;
  const gap = source.id === target.id ? 100 + Math.max(0, loops - 1) * 28 : 100;
  const x = below
    ? (sx + tx) / 2 - width / 2
    : Math.max(source.x + source.width, target.x + target.width) + 100;
  const y = below
    ? Math.max(source.y + source.height, target.y + target.height) + gap
    : (sy + ty) / 2 - height / 2;
  const position = { x, y };
  const axis = below ? 'y' : 'x';
  const length = below ? 'height' : 'width';
  for (const box of boxes.sort((a, b) => a[axis] - b[axis])) {
    if (
      position.x < box.x + box.width + 24 &&
      position.x + width > box.x - 24 &&
      position.y < box.y + box.height + 24 &&
      position.y + height > box.y - 24
    ) {
      position[axis] = box[axis] + box[length] + 24;
    }
  }
  return position;
}
