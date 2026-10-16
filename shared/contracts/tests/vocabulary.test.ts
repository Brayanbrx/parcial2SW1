import { describe, expect, it } from 'vitest';
import {
  BATCH_ORIGINS,
  COMMAND_TYPES,
  MULTIPLICITIES,
  SCHEMA_VERSION,
  collaborationRoomName,
} from '@uml/contracts';

describe('vocabulario cerrado', () => {
  it('expone exactamente los 11 comandos del plan maestro', () => {
    expect(COMMAND_TYPES).toHaveLength(11);
    expect(new Set(COMMAND_TYPES).size).toBe(11);
  });

  it('expone los cinco origenes de lote', () => {
    expect([...BATCH_ORIGINS]).toEqual(['GUI', 'AI_TEXT', 'AI_VOICE', 'IMAGE', 'XMI']);
  });

  it('solo soporta las multiplicidades de RM-04', () => {
    expect([...MULTIPLICITIES]).toEqual(['1', '0..1', '0..*', '1..*']);
  });

  it('declara la version de esquema (RA-09)', () => {
    expect(SCHEMA_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('nombra la sala por proyecto y pizarra (4.6)', () => {
    expect(collaborationRoomName('p1', 'b1')).toBe('project:p1:board:b1');
  });
});
