/** Depuración conservadora sin llamadas a modelos. Mantiene instrucciones,
 * negaciones, correcciones, nombres, tipos y cantidades. Siempre es revisable.
 */
export function prepareDictation(raw: string): string {
  return raw
    .trim()
    .replace(/^(?:(?:eh+|em+|ehm+)\s*[,;]\s*)+/i, '')
    .replace(
      /^(?:(?:hola|bueno|a ver)\s*[,!.]\s*)?(?:por favor\s*,?\s*)?(?:(?:lo que )?(?:quiero|necesito)(?: es)? que|me gustaría que|(?:me )?(?:puedes|podrías))\s+(?=(?:no\s+)?(?:crees|crear|agregues|agregar|añadas|añadir|elimines|eliminar|borres|borrar|cambies|cambiar|relaciones|relacionar|renombres|renombrar|expliques|explicar)\b)/i,
      '',
    )
    .replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`[^`]*`|«[^»]*»|\s+/gu, (part) =>
      /^\s/u.test(part) ? ' ' : part,
    )
    .trim();
}
