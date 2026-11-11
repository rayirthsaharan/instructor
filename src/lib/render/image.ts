import sharp from 'sharp';
import { MAX_INPUT_PIXELS, PAGE_IMAGE_MAX_DIM } from '../limits';

export class ImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageError';
  }
}

export interface NormalisedImage {
  data: Buffer;
  width: number;
  height: number;
  mime: 'image/webp';
  ext: 'webp';
}

/** Header-only check used at upload time: rejects corrupt images and decompression bombs without decoding pixels. */
export async function probeImage(data: Uint8Array): Promise<{ width: number; height: number }> {
  try {
    const m = await sharp(data, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' }).metadata();
    if (!m.width || !m.height) throw new Error('no dimensions');
    return { width: m.width, height: m.height };
  } catch {
    throw new ImageError('The image could not be read.');
  }
}

/** Applies EXIF orientation, bounds the size, strips metadata and stores as WebP. */
export async function normaliseImage(data: Uint8Array, maxDim: number = PAGE_IMAGE_MAX_DIM): Promise<NormalisedImage> {
  try {
    const { data: out, info } = await sharp(data, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' })
      .rotate()
      .resize({ width: maxDim, height: maxDim, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .webp({ quality: 88 })
      .toBuffer({ resolveWithObject: true });
    return { data: out, width: info.width, height: info.height, mime: 'image/webp', ext: 'webp' };
  } catch {
    throw new ImageError('The image could not be processed.');
  }
}
