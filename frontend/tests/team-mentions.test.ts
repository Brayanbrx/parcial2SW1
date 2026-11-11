import { describe, expect, it } from 'vitest';
import {
  extractAiMention,
  insertMention,
  matchesQuery,
  mentionOptions,
  mentionQuery,
  mentionSegments,
  resolveMentions,
  type MentionCandidate,
} from '../src/features/team-assistant/mentions.js';

const ana: MentionCandidate = { id: 'a', displayName: 'Ana' };
const anaMaria: MentionCandidate = { id: 'am', displayName: 'Ana María' };
const alejandro: MentionCandidate = { id: 'al', displayName: 'Alejandro Pérez' };
const brayan: MentionCandidate = { id: 'b', displayName: 'Brayan' };
const members = [ana, anaMaria, alejandro, brayan];

describe('detectar la mención que se está escribiendo', () => {
  it('solo abre con @ al inicio o tras un espacio, hasta el cursor', () => {
    expect(mentionQuery('@', 1)).toEqual({ start: 0, query: '' });
    expect(mentionQuery('hola @ale', 9)).toEqual({ start: 5, query: 'ale' });
    expect(mentionQuery('correo@dominio', 14)).toBeNull();
    expect(mentionQuery('hola @ale y más', 15)).toBeNull();
    // Con el cursor en medio de la palabra, cuenta lo escrito hasta él.
    expect(mentionQuery('@alejandro', 4)).toEqual({ start: 0, query: 'ale' });
  });
  it('filtra por cualquier palabra del nombre, sin tildes ni mayúsculas', () => {
    expect(matchesQuery('Alejandro Pérez', 'PER')).toBe(true);
    expect(matchesQuery('Ana María', 'mari')).toBe(true);
    expect(matchesQuery('Brayan', 'an')).toBe(false);
    expect(mentionOptions('an', members).map((m) => m.id)).toEqual(['a', 'am']);
    expect(mentionOptions('', members, 2)).toHaveLength(2);
  });
  it('inserta «@Nombre » y deja el cursor detrás', () => {
    expect(insertMention('hola @ale qué tal', 5, 9, 'Alejandro Pérez')).toEqual({
      text: 'hola @Alejandro Pérez qué tal',
      caret: 22,
    });
  });
});

describe('@IA cambia el destino y no queda en el texto', () => {
  it('mientras se escribe, solo cuando la palabra terminó', () => {
    expect(extractAiMention('@IA ¿qué es una composición?')).toBe('¿qué es una composición?');
    expect(extractAiMention('@ia, revisa esto')).toBe('revisa esto');
    expect(extractAiMention('oye @IA dime algo')).toBe('oye dime algo');
    expect(extractAiMention('@ia')).toBeNull();
    expect(extractAiMention('@iair hola')).toBeNull();
    expect(extractAiMention('correo@ia.com')).toBeNull();
  });
  it('al enviar también vale al final del mensaje', () => {
    expect(extractAiMention('revisa el modelo @IA', true)).toBe('revisa el modelo ');
    expect(extractAiMention('sin mención', true)).toBeNull();
  });
});

describe('las menciones viajan como IDs', () => {
  it('el nombre más largo gana: «@Ana María» no menciona también a Ana', () => {
    expect(resolveMentions('@Ana María mira esto', members)).toEqual(['am']);
    expect(resolveMentions('@ana y @Ana María', members).sort()).toEqual(['a', 'am']);
  });
  it('reconoce nombres con espacios, tildes y puntuación detrás', () => {
    expect(resolveMentions('@alejandro perez, ¿vienes?', members)).toEqual(['al']);
    expect(resolveMentions('gracias @Brayan.', members)).toEqual(['b']);
    expect(resolveMentions('gracias @Brayanito', members)).toEqual([]);
  });
  it('con nombres repetidos solo cuenta lo elegido en la lista', () => {
    const otraAna: MentionCandidate = { id: 'a2', displayName: 'Ana' };
    const team = [ana, otraAna];
    expect(resolveMentions('@Ana hola', team)).toEqual([]);
    expect(resolveMentions('@Ana hola', team, new Map([['a2', 'Ana']]))).toEqual(['a2']);
    // Si se borró la mención del texto, lo elegido ya no cuenta.
    expect(resolveMentions('hola', team, new Map([['a2', 'Ana']]))).toEqual([]);
  });
  it('ignora a quien ya no es integrante aunque se hubiera elegido', () => {
    expect(resolveMentions('@Carla hola', members, new Map([['c', 'Carla']]))).toEqual([]);
  });
});

describe('resaltar menciones al mostrar el mensaje', () => {
  it('parte el texto en tramos con la persona mencionada', () => {
    expect(
      mentionSegments('Hola @Ana María y @Brayan.', [
        { id: 'am', name: 'Ana María' },
        { id: 'b', name: 'Brayan' },
      ]),
    ).toEqual([
      { text: 'Hola ' },
      { text: '@Ana María', mention: 'am' },
      { text: ' y ' },
      { text: '@Brayan', mention: 'b' },
      { text: '.' },
    ]);
    expect(mentionSegments('sin menciones', [])).toEqual([{ text: 'sin menciones' }]);
  });
});
