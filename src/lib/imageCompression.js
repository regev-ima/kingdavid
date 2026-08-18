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

// Formats a browser can UPLOAD but not DISPLAY: Chrome renders none of these
// in an <img>, so a product photo stored as one shows as a broken icon in the
// catalog, the quote and the website — while the upload itself "succeeded".
// (WhatsApp attachments are unaffected on purpose: phones handle HEIC fine,
// so plain compressImage stays as it was.)
const UNDISPLAYABLE_TYPES = new Set(['image/heic', 'image/heif', 'image/tiff', 'image/bmp']);

/**
 * Compress an image that is going to be SHOWN in the browser — product photos,
 * covers, gallery images. Converts undisplayable formats (iPhone HEIC, TIFF)
 * to JPEG on the way; when the browser cannot decode the source at all (Chrome
 * cannot read HEIC), throws a Hebrew error the picker can show, instead of
 * uploading a file that renders broken everywhere.
 *
 * @param {File} file
 * @returns {Promise<File>}
 */
export async function compressImageForDisplay(file) {
  if (!file || !file.type?.startsWith('image/')) return file;
  if (!UNDISPLAYABLE_TYPES.has(file.type)) return compressImage(file);

  try {
    const converted = await imageCompression(file, { ...DEFAULTS, fileType: 'image/jpeg' });
    const stem = (file.name || 'image').replace(/\.[A-Za-z0-9]+$/, '');
    return new File([converted], `${stem}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
  } catch {
    throw new Error(
      'הקובץ בפורמט שהדפדפן לא מציג (HEIC/TIFF) ולא ניתן להמרה כאן. ' +
      'צלמו/ייצאו כ-JPG, או העלו מספארי/אייפון שממיר אוטומטית.',
    );
  }
}
