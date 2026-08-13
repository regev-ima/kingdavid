// Everything about turning a picked File into something Supabase Storage will
// actually accept — object key, content type, and a readable error when it
// still says no.
//
// WHY this exists: Storage validates the object key server-side against a fixed
// character set (storage-api's isValidKey):
//
//   word characters, plus  /  !  -  .  *  '  (  )  space  &  $  @  =  ;  :  +  ,  ?
//
// "Word characters" there is the JavaScript \w — [A-Za-z0-9_] — with no Unicode
// flag. Hebrew is not in that set. So the previous key, `${Date.now()}_${file.name}`
// used verbatim, made every Hebrew-named file fail with `Invalid key`, which is
// most files anyone in this CRM picks: "הצעת מחיר.pdf", "תמונה של המיטה.jpg".
// The upload never reached the bucket, and the rep saw an English error they
// could do nothing with. Attaching anything at all was effectively broken.
//
// The key is an internal storage path, not what the customer sees — WhatsApp
// sends the original file name separately (greenApiSend's `file_name`), so
// transliterating the key away costs nothing and the Hebrew name still arrives
// intact on the other end.

// Characters we keep in the human-readable part of a key. Deliberately much
// narrower than what Storage allows: spaces and quotes are legal in a key but
// have to be percent-encoded in the resulting public URL, and that URL gets
// handed to Green API to fetch. ASCII-only keys keep those URLs clean.
const UNSAFE_CHARS = /[^A-Za-z0-9._-]+/g;
const EXTENSION = /\.([A-Za-z0-9]{1,12})$/;
const MAX_STEM = 48;

// Extension → content type, for the cases where the browser hands us a File
// with an empty `type` (drag-and-drop and some Windows pickers do this).
// Without a fallback, supabase-js labels those `text/plain`, which the bucket's
// MIME allowlist then rejects — a valid PDF refused for being text.
const TYPE_BY_EXTENSION = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  avif: 'image/avif',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  csv: 'text/csv',
  txt: 'text/plain',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

/** Lower-cased extension without the dot ("Photo.JPG" → "jpg"), '' when none. */
export function fileExtension(name) {
  const match = EXTENSION.exec(String(name || ''));
  return match ? match[1].toLowerCase() : '';
}

/**
 * The readable part of a storage key: the original name with the extension
 * dropped and every unsafe character folded to '-'. Returns '' when nothing
 * survives (a fully Hebrew name), which is fine — the key stays unique on its
 * timestamp/random part alone.
 */
export function safeFileStem(name) {
  const withoutExt = String(name || '').replace(EXTENSION, '');
  return withoutExt
    .replace(UNSAFE_CHARS, '-')
    .replace(/-+/g, '-')
    .replace(/^[-._]+|[-._]+$/g, '')
    .slice(0, MAX_STEM)
    .replace(/[-._]+$/, '');
}

/**
 * Build a Storage object key that is guaranteed to pass isValidKey, keeps the
 * extension (the WhatsApp recorder maps `pdf` → document, `jpg` → image from
 * it), and can't collide with a concurrent upload of the same name.
 *
 * @param {string} fileName        original file name, any script
 * @param {object} [opts]
 * @param {string} [opts.unique]   override the uniqueness token (tests)
 * @returns {string}
 */
export function buildStorageKey(fileName, { unique } = {}) {
  const token = unique || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const stem = safeFileStem(fileName);
  const ext = fileExtension(fileName);

  const key = stem ? `${token}_${stem}` : token;
  return ext ? `${key}.${ext}` : key;
}

/**
 * The content type to upload a File as. Trusts the browser when it gave us one
 * and falls back to the extension, so a `.pdf` with an empty type still lands
 * as `application/pdf` instead of `text/plain`. Returns undefined when we can't
 * tell — supabase-js then applies its own default.
 */
export function contentTypeFor(file) {
  const declared = String(file?.type || '').trim();
  if (declared && declared !== 'application/octet-stream') return declared;
  return TYPE_BY_EXTENSION[fileExtension(file?.name)] || declared || undefined;
}

/**
 * Turn a Storage failure into something a rep can act on. The raw messages are
 * English and describe the API, not the problem ("new row violates row-level
 * security policy" for a file that is simply too big for their permissions).
 */
export function storageErrorMessage(error) {
  const raw = String(error?.message || error || '');
  const status = Number(error?.statusCode || error?.status || 0);
  const text = raw.toLowerCase();

  if (text.includes('invalid key')) return 'שם הקובץ מכיל תווים שאינם נתמכים';
  if (text.includes('mime type') || text.includes('not supported')) return 'סוג הקובץ אינו נתמך להעלאה';
  if (status === 413 || text.includes('maximum allowed size') || text.includes('too large') || text.includes('entity too large')) {
    return 'הקובץ גדול מדי להעלאה';
  }
  if (status === 401 || status === 403 || text.includes('row-level security') || text.includes('unauthorized')) {
    return 'אין הרשאה להעלות קבצים — פנה למנהל';
  }
  if (text.includes('already exists')) return 'קובץ בשם הזה כבר קיים, נסה שוב';
  if (text.includes('failed to fetch') || text.includes('network')) return 'ההעלאה נכשלה — בדוק את החיבור לאינטרנט';
  return raw || 'ההעלאה נכשלה';
}
