/**
 * Descarga un blob con el nombre que se le indique.
 *
 * El nombre lo pide la aplicación antes de llamar aquí, con un campo propio, y
 * no `showSaveFilePicker`. El selector nativo es más completo —deja elegir
 * también la carpeta— pero en un Chromium sin interfaz **no lanza error: se
 * queda colgado**, y el botón de exportar se quedaría girando para siempre sin
 * que nada lo explique. Un campo de texto propio funciona en todos los
 * navegadores, se puede probar de extremo a extremo y no tiene ese modo de
 * fallo.
 */
export function descargarBlob(blob: Blob, nombre: string): void {
  const enlace = document.createElement('a');
  enlace.href = URL.createObjectURL(blob);
  enlace.download = nombre;
  enlace.click();
  URL.revokeObjectURL(enlace.href);
}

/**
 * Deja el nombre en condiciones de ser un archivo.
 *
 * Quita lo que ningún sistema admite en un nombre y asegura la extensión: si
 * alguien escribe «Ventas» el archivo tiene que abrirse igual en Enterprise
 * Architect, y sin `.xmi` no lo ofrece siquiera en su diálogo.
 */
export function nombreDeArchivo(escrito: string, extension: string): string {
  const limpio = escrito
    .replace(/[\\/:*?"<>|]/g, '')
    .trim()
    .replace(/\.+$/, '');

  const base = limpio.length === 0 ? 'diagrama' : limpio;
  return base.toLowerCase().endsWith(extension) ? base : `${base}${extension}`;
}
