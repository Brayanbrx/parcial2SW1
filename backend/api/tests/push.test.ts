import { describe, expect, it } from 'vitest';
import type { Command } from '@uml/contracts';
import { describeBatch, parseServiceAccount } from '../src/modules/push/push.js';

const envelope = {
  commandId: '00000000-0000-4000-8000-000000000001',
  origin: 'GUI',
  actorId: '00000000-0000-4000-8000-000000000002',
  issuedAt: '2026-11-10T12:00:00.000Z',
} as const;
const classId = '00000000-0000-4000-8000-0000000000aa';

describe('notificaciones push', () => {
  it('nombra la tabla modificada usando el modelo conocido', () => {
    const commands: Command[] = [
      {
        ...envelope,
        type: 'ADD_ATTRIBUTE',
        payload: {
          classId,
          attributeId: '00000000-0000-4000-8000-0000000000bb',
          displayName: 'email',
          type: 'String',
        },
      },
    ];
    expect(describeBatch(commands, new Map([[classId, 'Cliente']]))).toBe(
      'agregó el campo email a la tabla Cliente',
    );
  });

  it('usa el nombre del propio lote al crear o renombrar', () => {
    const commands: Command[] = [
      { ...envelope, type: 'CREATE_CLASS', payload: { classId, displayName: 'Pedido' } },
    ];
    expect(describeBatch(commands, new Map())).toBe('creó la tabla Pedido');
  });

  it('resume los lotes largos', () => {
    const commands: Command[] = [
      { ...envelope, type: 'CREATE_CLASS', payload: { classId, displayName: 'A' } },
      { ...envelope, type: 'RENAME_CLASS', payload: { classId, displayName: 'B' } },
      { ...envelope, type: 'DELETE_CLASS', payload: { classId } },
    ];
    expect(describeBatch(commands, new Map())).toBe('creó la tabla B y 2 cambios más');
  });

  it('acepta la cuenta de servicio en JSON o base64 y rechaza lo incompleto', () => {
    const json = JSON.stringify({ project_id: 'p', client_email: 'a@b.c', private_key: 'k' });
    expect(parseServiceAccount(json)?.project_id).toBe('p');
    expect(parseServiceAccount(Buffer.from(json).toString('base64'))?.client_email).toBe('a@b.c');
    expect(parseServiceAccount('{"project_id":"p"}')).toBeNull();
    expect(parseServiceAccount('')).toBeNull();
    expect(parseServiceAccount(undefined)).toBeNull();
  });
});
