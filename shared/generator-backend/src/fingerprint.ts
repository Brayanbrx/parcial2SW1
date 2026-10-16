import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Huella del conjunto de plantillas (ADR-018).
 *
 * ADR-018 no almacena el artefacto: promete poder **regenerarlo** desde el
 * snapshot congelado. Esa promesa tiene una condicion que hasta ahora no estaba
 * escrita en ningun sitio: que las plantillas sean las mismas. Cambiar una coma
 * en `entity.java.hbs` cambia los bytes de todas las generaciones pasadas, y la
 * descarga de la semana que viene entregaria un archivo distinto bajo el mismo
 * identificador, sin decirlo.
 *
 * La huella se guarda con cada generacion. Al descargar se vuelve a calcular: si
 * no coincide, el artefacto se emite igual pero se sabe que ya no es el mismo, y
 * la ruta puede decirlo en lugar de mentir en silencio.
 *
 * Cubre las dos familias —`spring` y `dart`— porque una generacion ofrece los
 * dos objetivos y los dos salen del mismo directorio.
 */

export function defaultTemplatesRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../../../templates');
}

let memoria: { directorio: string; huella: string } | undefined;

/**
 * Huella hexadecimal de 16 caracteres, memorizada por directorio.
 *
 * Se memoriza porque no cambia mientras el proceso vive —las plantillas son
 * archivos de la imagen, no datos— y leer veintiséis archivos en cada generacion
 * seria trabajo repetido sin ninguna ganancia.
 */
export async function templatesFingerprint(directory = defaultTemplatesRoot()): Promise<string> {
  if (memoria?.directorio === directory) return memoria.huella;

  const hash = createHash('sha256');

  // Ordenado por ruta: el orden de `readdir` depende del sistema de archivos, y
  // una huella que cambia al copiar el proyecto a otra maquina no sirve de nada.
  for (const ruta of (await listar(directory)).sort()) {
    hash.update(ruta.slice(directory.length).replaceAll('\\', '/'));
    hash.update(await readFile(ruta));
  }

  const huella = hash.digest('hex').slice(0, 16);
  memoria = { directorio: directory, huella };
  return huella;
}

async function listar(directorio: string): Promise<string[]> {
  const entradas = await readdir(directorio, { withFileTypes: true });
  const rutas: string[] = [];

  for (const entrada of entradas) {
    const ruta = join(directorio, entrada.name);
    if (entrada.isDirectory()) rutas.push(...(await listar(ruta)));
    else rutas.push(ruta);
  }

  return rutas;
}

/** SHA-256 completo de un artefacto emitido, para comparar dos descargas. */
export function sha256(contenido: Uint8Array): string {
  return createHash('sha256').update(contenido).digest('hex');
}
