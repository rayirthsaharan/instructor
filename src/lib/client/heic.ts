/**
 * HEIC without a dependency: browsers that can decode it natively (Safari) are asked to draw it to a
 * JPEG; everywhere else this returns null and the caller shows the "could not convert" message.
 */
export async function convertHeicToJpeg(file: File): Promise<File | null> {
  try {
    if (typeof createImageBitmap !== 'function') return null;
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.9));
    if (!blob) return null;
    return new File([blob], file.name.replace(/\.(heic|heif)$/i, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return null;
  }
}
