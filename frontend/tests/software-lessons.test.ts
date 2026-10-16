import { describe, expect, it } from 'vitest';
import {
  findSoftwareLessons,
  readSoftwareProgress,
  softwareLessons,
} from '../src/features/help/software-lessons.js';

describe('ayuda del software', () => {
  it.each([
    ['¿Cómo invito a alguien?', 'collaboration'],
    ['¿Cómo descargo Android?', 'generation'],
    ['CLAVE PRIMARIA', 'diagram'],
    ['¿Cómo importo una imagen?', 'import'],
    ['¿Dónde cambio mi contraseña?', 'account'],
  ])('encuentra la respuesta para %s', (query, id) => {
    expect(findSoftwareLessons(query)[0]?.id).toBe(id);
  });
  it('admite búsqueda vacía y no inventa respuestas para temas desconocidos', () => {
    expect(findSoftwareLessons('')).toEqual(softwareLessons);
    expect(findSoftwareLessons('astrofisica')).toEqual([]);
  });
  it('recupera solo temas vigentes y únicos ante progreso antiguo o dañado', () => {
    expect(readSoftwareProgress('["projects","projects","retirado",12,"generation"]')).toEqual([
      'projects',
      'generation',
    ]);
    for (const value of [null, '{', 'null', '{}', '"projects"']) {
      expect(readSoftwareProgress(value)).toEqual([]);
    }
  });
});
