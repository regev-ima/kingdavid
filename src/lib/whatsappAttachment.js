// What may be attached to a WhatsApp message, and what to do about it before
// it is uploaded. Pure — no React, no network, no compressor — so the rules can
// be read and tested on their own (src/lib/whatsappAttachment.test.js).
//
// Two different problems live here, and they get opposite treatments:
//
//   Photos are big by accident. A phone camera writes 4–12MB, a DSLR more, and
//   none of that resolution survives WhatsApp's own re-encoding anyway. Refusing
//   them would be technically correct and useless to the rep standing in front
//   of a customer. So an oversized image is SHRUNK, not rejected — rejection is
//   the last resort, for files so large the browser would fall over decoding
//   them.
//
//   Documents can't be shrunk. A PDF is the quote; re-encoding it isn't an
//   option, so the only honest answer is a size limit, set to what Storage will
//   actually take (the bucket caps objects at 50MB) rather than a bigger number
//   that fails opaquely halfway through the upload. The previous 100MB client
//   check was exactly that: a 60MB PDF passed it, then died in the bucket.

// The bucket's own file_size_limit (supabase/migrations/20240201000001…).
// Client and bucket must agree — a client limit above it just moves the failure
// later and makes it unreadable.
export const MAX_UPLOAD_MB = 50;

// The ceiling for images, deliberately set ABOVE MAX_UPLOAD_MB: a 60MB photo
// compresses to about 4MB, so refusing it for exceeding a limit it will never
// reach would be the app being obtuse about a problem it can solve. That is the
// whole "too large image" answer — the limit that applies to a photo is what
// the browser can decode, not what Storage can hold.
//
// It is not unbounded, because decoding is the one part that can't be made
// cheap: a bitmap costs width × height × 4 bytes regardless of how well the
// file compressed, so an unbounded limit trades a clear error message for a
// hung tab on an office PC. Past this we say so instead.
export const MAX_IMAGE_INPUT_MB = 64;

// Target for compressed photos. WhatsApp re-encodes to roughly this anyway, so
// a bigger upload buys nothing but waiting.
export const IMAGE_TARGET_MB = 4;
export const IMAGE_MAX_DIMENSION = 2560;

// Formats WhatsApp renders inline as a photo. Anything else that is an image
// (HEIC from an iPhone, AVIF, TIFF, BMP) has to be converted on the way out, or
// it arrives as a file the customer probably can't open.
const RENDERABLE_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

// Offered in the file picker. Kept in step with the bucket's MIME allowlist —
// when the picker offers something the bucket refuses, the rep gets a failure
// for a file the app told them was fine.
export const ATTACHMENT_ACCEPT = [
  'image/*',
  'application/pdf',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.csv',
].join(',');

const mb = (bytes) => bytes / (1024 * 1024);

export function isImageAttachment(file) {
  return String(file?.type || '').startsWith('image/');
}

/** True when the file is an image WhatsApp can't show inline as-is. */
export function needsImageConversion(file) {
  return isImageAttachment(file) && !RENDERABLE_IMAGE_TYPES.has(file.type);
}

/**
 * Compression options for a picked image. GIFs keep their type (converting one
 * to JPEG throws away the animation); everything else that WhatsApp can't
 * render is forced to JPEG.
 */
export function imageCompressionOptions(file) {
  const options = {
    maxSizeMB: IMAGE_TARGET_MB,
    maxWidthOrHeight: IMAGE_MAX_DIMENSION,
    initialQuality: 0.82,
  };
  if (needsImageConversion(file)) options.fileType = 'image/jpeg';
  return options;
}

/**
 * Keep the extension honest after a conversion. browser-image-compression hands
 * back JPEG bytes under the original name, so an iPhone photo stays
 * "IMG_0042.HEIC" while containing JPEG — and greenApiSend types the message
 * from the extension, so it would be filed as a document and render as a
 * download link instead of a picture.
 *
 * @returns {File} the same file, renamed only when the type stopped matching
 */
export function alignNameToType(file) {
  if (!file) return file;
  const wanted = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[file.type];
  if (!wanted) return file;
  const current = (String(file.name || '').match(/\.([A-Za-z0-9]{1,12})$/)?.[1] || '').toLowerCase();
  if (current === wanted || (wanted === 'jpg' && current === 'jpeg')) return file;

  const stem = String(file.name || 'image').replace(/\.[A-Za-z0-9]{1,12}$/, '') || 'image';
  return new File([file], `${stem}.${wanted}`, { type: file.type, lastModified: file.lastModified });
}

/**
 * Gate a picked file before any work is done on it.
 * @returns {string|null} a Hebrew reason to refuse, or null to proceed
 */
export function attachmentRejection(file) {
  if (!file) return 'לא נבחר קובץ';
  if (file.size === 0) return 'הקובץ ריק';

  if (isImageAttachment(file)) {
    // Images are never refused for merely being big — that is what compression
    // is for. This is only the "the browser can't open this at all" ceiling.
    return mb(file.size) > MAX_IMAGE_INPUT_MB
      ? `התמונה גדולה מדי (עד ${MAX_IMAGE_INPUT_MB}MB) — שמור אותה בגודל קטן יותר ונסה שוב`
      : null;
  }

  return mb(file.size) > MAX_UPLOAD_MB
    ? `הקובץ גדול מדי (עד ${MAX_UPLOAD_MB}MB)`
    : null;
}

/**
 * Gate the file again once it's ready to upload — after compression, which may
 * have shrunk it below the limit or (on a failure) left it exactly as it was.
 * @returns {string|null}
 */
export function preparedRejection(file, { original } = {}) {
  if (!file) return 'הכנת הקובץ נכשלה';

  if (needsImageConversion(file)) {
    // Compression fell back to the original bytes, so the browser couldn't
    // decode this format — Chrome on Windows can't read HEIC. Sending it would
    // deliver the customer a file they can't open, so say what to do instead.
    return 'לא ניתן להמיר את התמונה (פורמט HEIC/‏RAW) — שמור אותה כ-JPG ונסה שוב';
  }

  if (mb(file.size) > MAX_UPLOAD_MB) {
    return isImageAttachment(file) && original && file.size >= original.size
      ? `לא הצלחנו להקטין את התמונה מתחת ל-${MAX_UPLOAD_MB}MB`
      : `הקובץ גדול מדי (עד ${MAX_UPLOAD_MB}MB)`;
  }
  return null;
}

/** "4.2MB" / "820KB" — for telling the rep what we actually sent. */
export function formatFileSize(bytes) {
  const size = Number(bytes) || 0;
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))}KB`;
  return `${(size / (1024 * 1024)).toFixed(1)}MB`;
}
