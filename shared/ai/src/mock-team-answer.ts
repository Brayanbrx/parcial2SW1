import type { TeamContext, TeamTurn } from './team-context.js';
import type { AnswerOptions } from './ports.js';

/** Solo para el proveedor mock: los proveedores reales interpretan intención en su prompt. */
export function mockWantsSolution(options: AnswerOptions): boolean {
  return (
    options.teaching?.solutionMode === 'ON_REQUEST' &&
    !/\bno\b.*(?:soluci[oó]n|resuelv|corrij|correcci[oó]n|resuelto)/i.test(options.question) &&
    /(?:dame|muestra|quiero|prop[oó]n).*(?:soluci[oó]n|correcci[oó]n)|c[oó]mo (?:lo )?(?:corrijo|soluciono)|ejemplo resuelto|resuelve/i.test(
      options.question,
    )
  );
}

export function mockTeachingReview(options: AnswerOptions): string {
  const solutions = mockWantsSolution(options);
  const labels = new Map(
    options.snapshot.classes.flatMap(
      (c) =>
        [
          [c.id, c.displayName],
          ...c.attributes.map((a) => [a.id, `${c.displayName}.${a.displayName}`]),
        ] as [string, string][],
    ),
  );
  for (const r of options.snapshot.relationships)
    labels.set(
      r.id,
      `${labels.get(r.sourceClassId) ?? 'Clase ausente'} — ${labels.get(r.targetClassId) ?? 'Clase ausente'}`,
    );
  const issues = [...(options.issues ?? [])].sort(
    (a, b) => Number(b.severity === 'ERROR') - Number(a.severity === 'ERROR'),
  );
  const hints: Record<string, string> = {
    MANY_TO_MANY_RELATIONSHIP:
      '¿Qué concepto representa cada vínculo entre esas dos clases y qué datos propios necesita?',
    INHERITANCE_CYCLE: '¿Puedes recorrer la jerarquía sin volver a una clase ya visitada?',
    DUPLICATE_ATTRIBUTE_NAME: '¿Los atributos representan el mismo dato o conceptos distintos?',
    DUPLICATE_CLASS_NAME: '¿Son conceptos diferentes aunque sus nombres técnicos coincidan?',
    CLASS_WITHOUT_RELATIONSHIPS:
      '¿Esta clase participa en alguna regla del negocio con otra clase?',
  };
  return [
    options.snapshot.classes.length === 0
      ? 'La pizarra está vacía; todavía no hay un modelo que revisar.'
      : 'Revisión del modelo enviado:',
    ...issues.map((issue) =>
      [
        `[${issue.severity}] ${issue.code}: ${issue.message}`,
        `Elementos: ${(issue.elementIds ?? []).map((id) => labels.get(id) ?? id).join(', ') || 'modelo'}.`,
        solutions && issue.suggestion
          ? `Solución sugerida: ${issue.suggestion}`
          : `Pista: ${hints[issue.code] ?? '¿Qué regla expresa este elemento y qué restricción debes comprobar?'}`,
      ].join(' '),
    ),
    issues.length === 0
      ? 'Sin hallazgos del validador; esto no acredita completitud funcional.'
      : 'Los errores bloquean la generación; las advertencias requieren revisar el criterio del negocio.',
    options.teaching?.solutionMode === 'HINTS_ONLY'
      ? 'El proyecto está en Solo pistas.'
      : solutions
        ? 'Las soluciones son sugerencias; no he aplicado cambios.'
        : 'Puedes pedir una solución explicada para un hallazgo concreto.',
  ].join('\n');
}

/** Oráculo determinista para CI/demo mock; no pretende sustituir comprensión LLM. */
export function mockTeamAnswer(
  question: string,
  team: TeamContext,
  options?: AnswerOptions,
): string {
  const turns = [...team.groupTurns, ...team.personalTurns].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
  const byId = new Map(turns.map((t) => [t.id, t]));
  const seen = new Set<string>();
  const followup = (text: string) =>
    /^(?:dame\s+)?otro\s+ejemplo|contin[uú]a|lo m[ií]o|retom|\beso\b|lo que (?:dijo|pregunt[oó])/i.test(
      text,
    );
  function topic(turn: TeamTurn): TeamTurn | undefined {
    if (seen.has(turn.id)) return undefined;
    seen.add(turn.id);
    if (turn.authorKind !== 'USER') {
      const parent = turn.replyToId ? byId.get(turn.replyToId) : undefined;
      return parent ? topic(parent) : undefined;
    }
    if (!followup(turn.text)) return turn;
    const explicit = turn.replyToId ? byId.get(turn.replyToId) : undefined;
    if (explicit) return topic(explicit);
    const previous = turns
      .slice(
        0,
        turns.findIndex((t) => t.id === turn.id),
      )
      .reverse()
      .find(
        (t) =>
          t.authorKind === 'USER' &&
          (/\beso\b|lo que/i.test(turn.text) || t.authorId === turn.authorId),
      );
    return previous ? topic(previous) : undefined;
  }
  const reference = team.replyToId ? byId.get(team.replyToId) : undefined;
  const latest = [...turns]
    .reverse()
    .find(
      (t) =>
        t.authorKind === 'USER' &&
        (/\beso\b|lo que/i.test(question) || t.authorId === team.requesterId),
    );
  const source = reference
    ? topic(reference)
    : followup(question) && latest
      ? topic(latest)
      : undefined;
  if ((reference || followup(question)) && !source)
    return `${team.requesterName}, ¿a qué tema te refieres? No tengo un antecedente suficiente en este contexto.`;
  const text = source?.text ?? question;
  const attribution =
    source && source.authorId !== team.requesterId
      ? `sobre la consulta de ${source.authorName}`
      : 'sobre tu consulta';
  const solutions = !options?.teaching || mockWantsSolution(options);
  const explanation = /atributo.*derivad/i.test(text)
    ? 'Un atributo derivado se calcula a partir de otros datos. ' +
      (solutions
        ? 'Ejemplo hipotético resuelto: total = cantidad × precio.'
        : '¿Qué datos necesitas para calcularlo y cuáles ya existen en tu pizarra?')
    : /herencia|generalizaci[oó]n/i.test(text)
      ? 'La herencia representa «es un tipo de». ' +
        (solutions
          ? 'Ejemplo hipotético resuelto: Cliente es un tipo de Persona; Cliente sería la subclase y Persona la superclase.'
          : '¿Cada instancia de la subclase también cumple la definición de la superclase?')
      : `Tema de referencia: ${JSON.stringify(text)}.`;
  const board = options?.snapshot.classes.map((c) => c.displayName).join(', ');
  return [
    `${team.requesterName}, ${attribution}: ${explanation}`,
    options?.teaching
      ? board
        ? `En tu pizarra: ${board}. Usa esos conceptos para comprobar la regla; no presupongo relaciones que no existen.`
        : 'Tu pizarra está vacía; el ejemplo es conceptual.'
      : '',
    options?.teaching?.solutionMode === 'HINTS_ONLY'
      ? 'El proyecto está en Solo pistas; puedo orientarte para que construyas la solución.'
      : '',
  ]
    .filter(Boolean)
    .join(' ');
}
