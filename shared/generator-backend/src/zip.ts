import { PassThrough } from 'node:stream';
import { ZipArchive } from 'archiver';
import type { GeneratedFile } from './types.js';

/** Fecha fija del formato ZIP para que dos generaciones identicas den los mismos bytes. */
const ZIP_ENTRY_DATE = new Date('2000-01-01T00:00:00.000Z');

export async function createProjectZip(files: readonly GeneratedFile[]): Promise<Buffer> {
  const output = new PassThrough();
  const chunks: Buffer[] = [];
  output.on('data', (chunk: Buffer) => chunks.push(chunk));

  const completed = new Promise<Buffer>((resolve, reject) => {
    output.once('end', () => resolve(Buffer.concat(chunks)));
    output.once('error', reject);
  });

  const archive = new ZipArchive({ zlib: { level: 9 }, forceLocalTime: false });
  archive.once('error', (error) => output.destroy(error));
  archive.on('warning', (error) => {
    if (error.code === 'ENOENT') return;
    output.destroy(error);
  });
  archive.pipe(output);

  for (const file of [...files].sort((left, right) => left.path.localeCompare(right.path, 'en'))) {
    assertSafeRelativePath(file.path);
    archive.append(Buffer.from(file.content, 'utf8'), {
      name: file.path,
      date: ZIP_ENTRY_DATE,
      mode: 0o100644,
    });
  }

  await archive.finalize();
  return completed;
}

function assertSafeRelativePath(path: string): void {
  if (path.startsWith('/') || path.includes('\\') || path.split('/').includes('..')) {
    throw new Error(`Ruta insegura en el ZIP generado: ${path}`);
  }
}
