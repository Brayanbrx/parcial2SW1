import type { RelationshipKind } from '@uml/contracts';

export type EditorTool =
  'SELECT' | 'CLASS' | 'ASSOCIATION' | 'GENERALIZATION' | 'COMPOSITION' | 'AGGREGATION';

export interface RelationshipToolDefinition {
  readonly tool: Exclude<EditorTool, 'SELECT' | 'CLASS'>;
  readonly kind: RelationshipKind;
  readonly label: string;
  readonly description: string;
  readonly shortcut: string;
}

export const RELATIONSHIP_TOOLS: readonly RelationshipToolDefinition[] = [
  {
    tool: 'ASSOCIATION',
    kind: 'ASSOCIATION',
    label: 'Asociación',
    description: 'Vínculo estructural con multiplicidades',
    shortcut: '1',
  },
  {
    tool: 'GENERALIZATION',
    kind: 'GENERALIZATION',
    label: 'Generalización',
    description: 'Herencia: subclase hacia superclase',
    shortcut: '2',
  },
  {
    tool: 'COMPOSITION',
    kind: 'COMPOSITION',
    label: 'Composición',
    description: 'El origen controla el ciclo de vida',
    shortcut: '3',
  },
  {
    tool: 'AGGREGATION',
    kind: 'AGGREGATION',
    label: 'Agregación',
    description: 'Relación todo-parte independiente',
    shortcut: '4',
  },
];

export function isRelationshipTool(tool: EditorTool): tool is RelationshipToolDefinition['tool'] {
  return tool !== 'SELECT' && tool !== 'CLASS';
}

export function relationshipKindFor(tool: RelationshipToolDefinition['tool']): RelationshipKind {
  return tool;
}

export function toolLabel(tool: EditorTool): string {
  if (tool === 'SELECT') return 'Seleccionar';
  if (tool === 'CLASS') return 'Clase';
  return RELATIONSHIP_TOOLS.find((item) => item.tool === tool)?.label ?? tool;
}
