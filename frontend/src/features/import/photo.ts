const MAX_PHOTO_BYTES = 6_000_000;
const fileTypes: Readonly<Record<string, string>> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};

export async function preparePhoto(file: File): Promise<Blob> {
  if (!file.size) throw new Error('La foto está vacía.');
  const suffix = file.name.split('.').at(-1)?.toLowerCase() ?? '';
  const mediaType = file.type || fileTypes[suffix];
  if (file.size <= MAX_PHOTO_BYTES && mediaType && Object.values(fileTypes).includes(mediaType))
    return file.type ? file : file.slice(0, file.size, mediaType);

  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode().catch(() => {
      throw new Error('No se pudo abrir esta foto. Prueba con JPG, PNG o WebP.');
    });
    if (!image.naturalWidth || !image.naturalHeight)
      throw new Error('La foto no tiene dimensiones válidas.');
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 2560 / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No se pudo preparar la foto.');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const jpeg = (quality: number) =>
      new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    const first = await jpeg(0.92);
    const photo = first && first.size <= MAX_PHOTO_BYTES ? first : await jpeg(0.78);
    if (!photo || photo.size > MAX_PHOTO_BYTES)
      throw new Error('La foto es demasiado grande. Recórtala al diagrama o toma otra foto.');
    return photo;
  } finally {
    URL.revokeObjectURL(url);
  }
}
