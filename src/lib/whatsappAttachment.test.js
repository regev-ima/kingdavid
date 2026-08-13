// Behavioural test for the WhatsApp attachment rules in ./whatsappAttachment.js.
//
//   node src/lib/whatsappAttachment.test.js
//
// WHY this exists: the rules here are asymmetric on purpose, and the asymmetry
// is easy to "tidy up" into a bug. A big photo must be SHRUNK (refusing it
// leaves a rep unable to answer a customer over something the app can fix by
// itself); a big PDF must be REFUSED (it is the quote — re-encoding it is not
// an option, and pretending 100MB will upload just moves the failure to a
// place with no error message). Both directions are asserted below, along with
// the extension/type alignment that decides whether a photo arrives as a
// picture or as a download link.

import assert from 'node:assert/strict';
import {
  ATTACHMENT_ACCEPT, IMAGE_MAX_DIMENSION, IMAGE_TARGET_MB, MAX_IMAGE_INPUT_MB, MAX_UPLOAD_MB,
  alignNameToType, attachmentRejection, formatFileSize, imageCompressionOptions,
  isImageAttachment, needsImageConversion, preparedRejection,
} from './whatsappAttachment.js';

const MB = 1024 * 1024;

// A File of a stated size without allocating it: `size` is read-only and
// derived from the parts, so it is overridden rather than filled with 30MB of
// zeroes. Nothing under test reads the bytes.
const fileOf = (name, type, sizeMB) =>
  Object.defineProperty(new File([new Uint8Array(1)], name, { type, lastModified: 0 }), 'size', {
    value: Math.round(sizeMB * MB),
  });

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`FAIL  ${name}\n      ${err.message}`);
  }
}

console.log('\nPDFs — the thing the client explicitly asked to keep working');

test('an ordinary quote PDF is accepted', () => {
  assert.equal(attachmentRejection(fileOf('הצעת מחיר.pdf', 'application/pdf', 2)), null);
});

test('a PDF just under the bucket limit is accepted', () => {
  assert.equal(attachmentRejection(fileOf('catalog.pdf', 'application/pdf', MAX_UPLOAD_MB - 1)), null);
});

test('a PDF over the bucket limit is refused up front, not mid-upload', () => {
  const reason = attachmentRejection(fileOf('catalog.pdf', 'application/pdf', MAX_UPLOAD_MB + 10));
  assert.ok(reason, 'must be refused');
  assert.ok(reason.includes(String(MAX_UPLOAD_MB)), `the limit must be in the message: "${reason}"`);
});

test('the client limit matches the bucket, so nothing dies opaquely in Storage', () => {
  // 52428800 bytes in supabase/migrations/20260813000001_uploads_mime_types.sql.
  assert.equal(MAX_UPLOAD_MB * MB, 52428800);
});

test('PDFs are never routed through image compression', () => {
  const pdf = fileOf('quote.pdf', 'application/pdf', 30);
  assert.equal(isImageAttachment(pdf), false);
  assert.equal(needsImageConversion(pdf), false);
  assert.equal(alignNameToType(pdf).name, 'quote.pdf', 'the name must survive untouched');
});

console.log('\nOversized photos — shrunk, not refused');

test('a 9MB phone photo is accepted for compression, not rejected', () => {
  assert.equal(attachmentRejection(fileOf('IMG_0042.jpg', 'image/jpeg', 9)), null);
});

test('a photo over the document limit is still accepted for compression', () => {
  // The whole point of the asymmetry: this size would be refused outright as a
  // document, and must NOT be refused as an image — compression is expected to
  // bring it under the cap before the upload.
  const oversized = MAX_UPLOAD_MB + 1;
  assert.ok(attachmentRejection(fileOf('scan.pdf', 'application/pdf', oversized)), 'as a document: refused');
  assert.equal(attachmentRejection(fileOf('scan.png', 'image/png', oversized)), null, 'as an image: accepted');
});

test('the photo ceiling sits above the upload cap, or shrinking is pointless', () => {
  // If these two ever cross, an oversized photo gets refused for exceeding a
  // limit compression would have taken it well under — which is the exact
  // behaviour this module exists to prevent.
  assert.ok(
    MAX_IMAGE_INPUT_MB > MAX_UPLOAD_MB,
    `photos must be accepted past the ${MAX_UPLOAD_MB}MB upload cap, got ${MAX_IMAGE_INPUT_MB}MB`,
  );
});

test('only a photo too big to decode safely is refused', () => {
  const reason = attachmentRejection(fileOf('huge.jpg', 'image/jpeg', MAX_IMAGE_INPUT_MB + 5));
  assert.ok(reason, 'must be refused');
  assert.ok(reason.includes(String(MAX_IMAGE_INPUT_MB)), reason);
});

test('compression targets a size WhatsApp will actually keep', () => {
  const opts = imageCompressionOptions(fileOf('x.jpg', 'image/jpeg', 9));
  assert.equal(opts.maxSizeMB, IMAGE_TARGET_MB);
  assert.equal(opts.maxWidthOrHeight, IMAGE_MAX_DIMENSION);
  assert.ok(IMAGE_TARGET_MB < MAX_UPLOAD_MB, 'the target must land under the upload cap');
});

test('an empty file is refused whatever its type', () => {
  assert.ok(attachmentRejection(fileOf('empty.pdf', 'application/pdf', 0)));
  assert.ok(attachmentRejection(null));
});

console.log('\nFormat conversion — whether it arrives as a picture or a download link');

test('JPEG/PNG/WebP/GIF are sent as they are', () => {
  for (const type of ['image/jpeg', 'image/png', 'image/webp', 'image/gif']) {
    assert.equal(needsImageConversion(fileOf('x', type, 1)), false, type);
    assert.equal(imageCompressionOptions(fileOf('x', type, 1)).fileType, undefined, type);
  }
});

test('an iPhone HEIC photo is converted to JPEG', () => {
  const heic = fileOf('IMG_0042.HEIC', 'image/heic', 3);
  assert.equal(needsImageConversion(heic), true);
  assert.equal(imageCompressionOptions(heic).fileType, 'image/jpeg');
});

test('a GIF keeps its type so the animation is not flattened', () => {
  assert.equal(imageCompressionOptions(fileOf('loop.gif', 'image/gif', 2)).fileType, undefined);
});

test('a converted photo is renamed, or it would send as a document', () => {
  // greenApiSend types the message from the extension: leave "IMG.HEIC" on
  // JPEG bytes and the customer gets a download link instead of a picture.
  const converted = fileOf('IMG_0042.HEIC', 'image/jpeg', 1);
  assert.equal(alignNameToType(converted).name, 'IMG_0042.jpg');
});

test('an unconverted name is left alone, including .jpeg', () => {
  assert.equal(alignNameToType(fileOf('a.jpeg', 'image/jpeg', 1)).name, 'a.jpeg');
  assert.equal(alignNameToType(fileOf('a.jpg', 'image/jpeg', 1)).name, 'a.jpg');
  assert.equal(alignNameToType(fileOf('תמונה.png', 'image/png', 1)).name, 'תמונה.png');
});

test('a Hebrew name survives conversion — it is what the customer sees', () => {
  assert.equal(alignNameToType(fileOf('תמונה של המיטה.heic', 'image/jpeg', 1)).name, 'תמונה של המיטה.jpg');
});

console.log('\nAfter compression — the second gate');

test('a compressed photo under the cap passes', () => {
  const original = fileOf('IMG.jpg', 'image/jpeg', 9);
  assert.equal(preparedRejection(fileOf('IMG.jpg', 'image/jpeg', 1.2), { original }), null);
});

test('a HEIC the browser could not decode is refused with what to do about it', () => {
  // compressImage returns the original on failure — Chrome on Windows cannot
  // read HEIC. Sending it would hand the customer a file they cannot open.
  const original = fileOf('IMG.HEIC', 'image/heic', 3);
  const reason = preparedRejection(original, { original });
  assert.ok(reason, 'must be refused');
  assert.ok(reason.includes('JPG'), `must say what to do: "${reason}"`);
});

test('a photo that would not shrink enough is refused, and says so', () => {
  const original = fileOf('huge.png', 'image/png', MAX_UPLOAD_MB + 5);
  const reason = preparedRejection(original, { original });
  assert.ok(reason && reason.includes(String(MAX_UPLOAD_MB)), reason);
});

console.log('\nPicker / bucket agreement');

test('every type the picker offers is one the bucket accepts', () => {
  // The bucket allowlist in 20260813000001_uploads_mime_types.sql, by extension.
  const allowed = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv']);
  for (const entry of ATTACHMENT_ACCEPT.split(',')) {
    if (!entry.startsWith('.')) continue;
    assert.ok(allowed.has(entry.slice(1)), `picker offers ${entry}, bucket does not allow it`);
  }
});

test('the picker offers images and PDFs at all', () => {
  assert.ok(ATTACHMENT_ACCEPT.includes('image/*'));
  assert.ok(ATTACHMENT_ACCEPT.includes('application/pdf'));
});

console.log('\nformatFileSize');

test('reads naturally at both scales', () => {
  assert.equal(formatFileSize(800 * 1024), '800KB');
  assert.equal(formatFileSize(4.25 * MB), '4.3MB');
  assert.equal(formatFileSize(0), '1KB');
});

console.log(failures === 0 ? '\nAll passed.\n' : `\n${failures} failed.\n`);
process.exit(failures === 0 ? 0 : 1);
