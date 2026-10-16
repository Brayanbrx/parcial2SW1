/** Evaluación optativa: ocho llamadas como máximo al proveedor principal, sin
 * respaldos ni reintentos. Nunca lee ni modifica pizarras del usuario.
 * node --env-file=infra/.env --import tsx scripts/verify-ai-prompts.ts --live
 */
import { mkdir, writeFile } from 'node:fs/promises';
import {
  createAiPorts,
  loadAiConfig,
  type AssistantOperation,
  type ConversationTurn,
} from '@uml/ai';
import type { SemanticModel } from '@uml/contracts';

if (!process.argv.includes('--live'))
  throw new Error('Usa --live para autorizar llamadas reales de evaluación.');
const model = (...names: string[]): SemanticModel => ({
  classes: names.map((name, index) => ({
    id: `33333333-3333-4333-8333-${String(index + 1).padStart(12, '0')}`,
    displayName: name,
    codeName: name,
    databaseName: name.toLowerCase(),
    attributes: [],
  })),
  relationships: [],
});
const cliente = model('Cliente');
const withEmail: SemanticModel = {
  ...cliente,
  classes: cliente.classes.map((item) => ({
    ...item,
    attributes: [
      {
        id: '44444444-4444-4444-8444-444444444444',
        displayName: 'correo',
        codeName: 'correo',
        databaseName: 'correo',
        type: 'String',
        primaryKey: false,
        nullable: false,
        unique: true,
      },
    ],
  })),
};
type Case = {
  name: string;
  instruction: string;
  snapshot: SemanticModel;
  context?: readonly ConversationTurn[];
  expected?: readonly Partial<AssistantOperation>[];
  clarification?: boolean;
};
const cases: readonly Case[] = [
  {
    name: 'negación y autocorrección',
    instruction: 'Eh, no borres Cliente. Agrega edad entero, perdón decimal, a Cliente.',
    snapshot: cliente,
    expected: [
      { op: 'ADD_ATTRIBUTE', className: 'Cliente', attributeName: 'edad', type: 'Decimal' },
    ],
  },
  {
    name: 'cardinalidades dictadas',
    instruction:
      'Relaciona Cliente y Venta. Cada venta tiene exactamente un cliente; cada cliente tiene cero a muchas ventas.',
    snapshot: model('Cliente', 'Venta'),
    expected: [
      {
        op: 'CREATE_RELATIONSHIP',
        fromClass: 'Cliente',
        toClass: 'Venta',
        fromMultiplicity: '1',
        toMultiplicity: '0..*',
      },
    ],
  },
  {
    name: 'restricciones negativas',
    instruction: 'El correo de Cliente debe ser opcional y no único. Mantén el nombre y tipo.',
    snapshot: withEmail,
    expected: [
      {
        op: 'UPDATE_ATTRIBUTE',
        className: 'Cliente',
        attributeName: 'correo',
        required: false,
        unique: false,
      },
    ],
  },
  {
    name: 'herencia',
    instruction: 'Crea Estudiante que hereda de Persona, sin agregar atributos.',
    snapshot: model('Persona'),
    expected: [
      { op: 'CREATE_CLASS', className: 'Estudiante' },
      {
        op: 'CREATE_RELATIONSHIP',
        kind: 'GENERALIZATION',
        fromClass: 'Estudiante',
        toClass: 'Persona',
        fromMultiplicity: '1',
        toMultiplicity: '1',
      },
    ],
  },
  {
    name: 'acciones dependientes',
    instruction:
      'Crea Producto, renómbralo a Articulo y agrega stock entero a Articulo. No agregues otros campos.',
    snapshot: model(),
    expected: [
      { op: 'CREATE_CLASS', className: 'Producto' },
      { op: 'RENAME_CLASS', className: 'Producto', newName: 'Articulo' },
      { op: 'ADD_ATTRIBUTE', className: 'Articulo', attributeName: 'stock', type: 'Integer' },
    ],
  },
  {
    name: 'aclaración ordinal',
    instruction: 'la segunda',
    snapshot: model('Empleado', 'Cliente'),
    context: [
      { role: 'user', text: 'Agrega telefono String a esa clase; no borres nada.' },
      { role: 'assistant', text: '¿En qué clase?\n1. "Empleado"\n2. "Cliente"' },
    ],
    expected: [
      { op: 'ADD_ATTRIBUTE', className: 'Cliente', attributeName: 'telefono', type: 'String' },
    ],
  },
  {
    name: 'teléfono conserva ceros',
    instruction: 'Añade numeroTelefono a Cliente, sin indicar clave primaria.',
    snapshot: cliente,
    expected: [
      {
        op: 'ADD_ATTRIBUTE',
        className: 'Cliente',
        attributeName: 'numeroTelefono',
        type: 'String',
      },
    ],
  },
  {
    name: 'límite no representable',
    instruction:
      'Cada Grupo debe tener exactamente entre 2 y 5 Personas. Relaciona ambas clases y conserva ese límite exacto.',
    snapshot: model('Grupo', 'Persona'),
    clarification: true,
  },
];
const config = loadAiConfig({
  ...process.env,
  AI_LLM_FALLBACK_PROVIDER: '',
  AI_LLM_FALLBACK_MODEL: '',
  AI_LLM_FALLBACKS: '[]',
  AI_VISION_PROVIDER: 'mock',
  AI_VISION_FALLBACK_PROVIDER: '',
  AI_VISION_FALLBACK_MODEL: '',
  AI_VISION_FALLBACKS: '[]',
  AI_SPEECH_PROVIDER: 'mock',
  AI_SPEECH_FALLBACK_PROVIDER: '',
  AI_SPEECH_FALLBACK_MODEL: '',
  AI_SPEECH_FALLBACKS: '[]',
  AI_MAX_RETRIES: '0',
  AI_TIMEOUT_MS: '45000',
  AI_CHAIN_TIMEOUT_MS: '45000',
});
if (config.AI_LLM_PROVIDER === 'mock')
  throw new Error('El proveedor es simulado; no se puede acreditar calidad real.');
const ports = createAiPorts(config);
const results: object[] = [];
let failed = false;
for (const item of cases) {
  try {
    const result = await ports.llm.proposeCommands(item);
    const passed = item.clarification
      ? Boolean(result.proposal.needsClarification) && result.proposal.operations.length === 0
      : !result.proposal.needsClarification &&
        result.proposal.operations.length === item.expected?.length &&
        item.expected.every((expected, index) =>
          Object.entries(expected).every(
            ([key, value]) =>
              (result.proposal.operations[index] as unknown as Record<string, unknown>)[key] ===
              value,
          ),
        );
    results.push({ name: item.name, passed, proposal: result.proposal, usage: result.usage });
    process.stdout.write(`${passed ? 'PASS' : 'FAIL'} ${item.name}\n`);
    failed ||= !passed;
  } catch (error) {
    // No imprimir objetos de SDK: pueden contener cabeceras con credenciales.
    results.push({
      name: item.name,
      blocked: true,
      errorType: error instanceof Error ? error.name : 'UnknownError',
    });
    process.stdout.write(
      `BLOCKED ${item.name}: ${error instanceof Error ? error.name : 'UnknownError'}\n`,
    );
    failed = true;
    break;
  }
}
await mkdir('reports/revision-ia-2026-09-10', { recursive: true });
await writeFile(
  'reports/revision-ia-2026-09-10/proveedor-real.json',
  JSON.stringify(
    {
      date: new Date().toISOString(),
      provider: config.AI_LLM_PROVIDER,
      model: config.AI_LLM_MODEL,
      planned: cases.length,
      results,
    },
    null,
    2,
  ),
);
process.exitCode = failed ? 1 : 0;
