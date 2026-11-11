import { MAX_TEAM_MENTIONS } from '@uml/contracts';

/**
 * Menciones con @ en la conversación del equipo.
 *
 * El texto conserva «@Nombre» para leerse con naturalidad, pero lo que viaja al
 * servidor son identificadores: un nombre repetido o cambiado después no puede
 * desviar el aviso a otra persona. Todo es puro para probarse sin navegador.
 */

export interface MentionCandidate {
  readonly id: string;
  readonly displayName: string;
  /** Rol u otra pista breve para la lista de sugerencias. */
  readonly hint?: string;
}

/** Sin tildes ni mayúsculas: «@alejandro» encuentra a «Alejándro». */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('es');
}

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Lo que puede seguir a una mención completa sin formar parte del nombre. */
const AFTER = String.raw`(?=$|[\s,.;:!?)\]¿¡])`;

/** El fragmento «@texto» que se está escribiendo justo antes del cursor. */
export function mentionQuery(
  text: string,
  caret: number,
): { readonly start: number; readonly query: string } | null {
  const match = /(?:^|\s)@([^\s@]{0,40})$/u.exec(text.slice(0, caret));
  if (!match) return null;
  const query = match[1] ?? '';
  return { start: caret - query.length - 1, query };
}

/** Coincide si alguna palabra del nombre (o el nombre entero) empieza por la consulta. */
export function matchesQuery(name: string, query: string): boolean {
  const q = fold(query);
  if (!q) return true;
  const folded = fold(name);
  return folded.startsWith(q) || folded.split(/\s+/).some((word) => word.startsWith(q));
}

export function mentionOptions(
  query: string,
  members: readonly MentionCandidate[],
  limit = 6,
): MentionCandidate[] {
  return members.filter((member) => matchesQuery(member.displayName, query)).slice(0, limit);
}

/** Sustituye el fragmento escrito por «@Nombre » y devuelve dónde queda el cursor. */
export function insertMention(
  text: string,
  start: number,
  caret: number,
  name: string,
): { readonly text: string; readonly caret: number } {
  const rest = text.slice(caret).replace(/^[ \t]+/, '');
  const insert = `@${name} `;
  return { text: text.slice(0, start) + insert + rest, caret: start + insert.length };
}

/**
 * «@IA» escrito a mano. Mientras se escribe solo cuenta cuando ya terminó la
 * palabra (para no confundir «@Iair»); al enviar también vale al final.
 */
const AI_TOKEN_TYPED = new RegExp(String.raw`(^|\s)@ia(?=[\s,.;:!?¿¡])[ \t]?`, 'iu');
const AI_TOKEN_FINAL = new RegExp(String.raw`(^|\s)@ia${AFTER}[ \t]?`, 'iu');

/** Devuelve el texto sin la mención a la IA, o null si no la hay. */
export function extractAiMention(text: string, final = false): string | null {
  const pattern = final ? AI_TOKEN_FINAL : AI_TOKEN_TYPED;
  const match = pattern.exec(text);
  if (!match) return null;
  const prefix = match[1] ?? '';
  const cut = text.slice(0, match.index) + prefix + text.slice(match.index + match[0].length);
  // «@IA, ¿qué es…?» no debe empezar por la coma que separaba la mención.
  return match.index === 0 ? cut.replace(/^[\s,;:.]+/, '') : cut;
}

/**
 * IDs mencionados en el texto. Lo elegido en la lista manda, porque distingue
 * a dos personas con el mismo nombre; lo escrito a mano solo cuenta si el
 * nombre identifica a una sola persona. Los nombres largos se buscan primero
 * para que «@Ana María» no cuente también como «@Ana».
 */
export function resolveMentions(
  text: string,
  members: readonly MentionCandidate[],
  picked: ReadonlyMap<string, string> = new Map(),
): string[] {
  let rest = fold(text);
  const take = (name: string): boolean => {
    const pattern = new RegExp(String.raw`(^|\s)@${escapeRegex(fold(name))}${AFTER}`, 'u');
    const match = pattern.exec(rest);
    if (!match) return false;
    const from = match.index + (match[1]?.length ?? 0);
    const length = match[0].length - (match[1]?.length ?? 0);
    rest = rest.slice(0, from) + ' '.repeat(length) + rest.slice(from + length);
    return true;
  };
  const byLength = <T>(items: readonly T[], name: (item: T) => string) =>
    [...items].sort((a, b) => name(b).length - name(a).length);
  const known = new Set(members.map((member) => member.id));
  const ids: string[] = [];
  for (const [id, name] of byLength([...picked], ([, n]) => n))
    if (known.has(id) && !ids.includes(id) && take(name)) ids.push(id);
  const repeated = new Map<string, number>();
  for (const member of members) {
    const key = fold(member.displayName);
    repeated.set(key, (repeated.get(key) ?? 0) + 1);
  }
  for (const member of byLength(members, (m) => m.displayName))
    if (
      !ids.includes(member.id) &&
      repeated.get(fold(member.displayName)) === 1 &&
      take(member.displayName)
    )
      ids.push(member.id);
  return ids.slice(0, MAX_TEAM_MENTIONS);
}

export interface TextSegment {
  readonly text: string;
  /** ID de la persona mencionada en este tramo, si lo es. */
  readonly mention?: string;
}

/** Parte el texto para resaltar «@Nombre» de las personas mencionadas. */
export function mentionSegments(
  text: string,
  mentions: readonly { readonly id: string; readonly name: string }[],
): TextSegment[] {
  const named = mentions.filter((mention) => mention.name.trim());
  if (!named.length) return [{ text }];
  const byName = new Map(
    named.map((mention) => [mention.name.toLocaleLowerCase('es'), mention.id]),
  );
  const alternatives = [...byName.keys()]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegex)
    .join('|');
  const pattern = new RegExp(String.raw`(^|\s)@(${alternatives})${AFTER}`, 'giu');
  const segments: TextSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const at = match.index + (match[1]?.length ?? 0);
    if (at > last) segments.push({ text: text.slice(last, at) });
    const end = match.index + match[0].length;
    const id = byName.get((match[2] ?? '').toLocaleLowerCase('es'));
    segments.push(id ? { text: text.slice(at, end), mention: id } : { text: text.slice(at, end) });
    last = end;
  }
  if (last < text.length) segments.push({ text: text.slice(last) });
  return segments;
}
