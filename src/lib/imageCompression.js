import imageCompression from 'browser-image-compression';

const DEFAULTS = {
  maxSizeMB: 1,
  maxWidthOrHeight: 1920,
  useWebWorker: true,
  initialQuality: 0.8,
};

// Skip formats where compression is useless or harmful (vector / animated).
const SKIP_TYPES = new Set(['image/svg+xml', 'image/gif']);

/**
 * Compress an image file client-side before upload.
 * Falls back to the original file if compression fails for any reason,
 * so uploads never break because of this helper.
 *
 * @param {File} file
 * @param {object} [overrides] - overrides for browser-image-compression options
 * @returns {Promise<File>}
 */
export async function compressImage(file, overrides = {}) {
  if (!file || !file.type?.startsWith('image/')) return file;
  if (SKIP_TYPES.has(file.type)) return file;

  try {
    const compressed = await imageCompression(file, { ...DEFAULTS, ...overrides });
    // Preserve the original filename so it keeps a meaningful name in storage.
    return new File([compressed], file.name, {
      type: compressed.type,
      lastModified: Date.now(),
    });
  } catch (err) {
    console.warn('Image compression failed, uploading original:', err);
    return file;
  }
}
