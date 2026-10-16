import { readSemanticModel } from '@uml/yjs-adapter';
import type { PrismaClient } from '@prisma/client';
import * as Y from 'yjs';

/**
 * Persistencia del documento
 * El documento se guarda en su representacion binaria, es lo unico que puede reabrir
 * la sesion colaborativa conservando el historial de operaciones del CRDT.
 *
 * El JSON canonico se guarda. como proyeccion derivada, para validar,
 * generar e inspeccionar sin cargar Yjs. Nunca reconstruye el documento: si
 * alguna vez se intentara, se perderia el historial y dos replicas que estaban
 * convergiendo dejarian de hacerlo.
 */

export async function loadBoardDocument(
  prisma: PrismaClient,
  boardId: string,
  document: Y.Doc,
): Promise<boolean> {
  const stored = await prisma.boardDocument.findUnique({
    where: { boardId },
    select: { state: true },
  });

  if (stored === null) return false;

  Y.applyUpdate(document, new Uint8Array(stored.state));
  return true;
}

export async function storeBoardDocument(
  prisma: PrismaClient,
  boardId: string,
  document: Y.Doc,
): Promise<void> {
  const state = Buffer.from(Y.encodeStateAsUpdate(document));
  const canonicalJson = readSemanticModel(document);

  await prisma.$transaction([
    prisma.boardDocument.upsert({
      where: { boardId },
      create: { boardId, state },
      update: { state },
    }),

    prisma.boardSnapshot.upsert({
      where: { boardId_version: { boardId, version: 1 } },
      create: { boardId, version: 1, canonicalJson },
      update: { canonicalJson },
    }),
  ]);
}
