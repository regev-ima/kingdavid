// Behavioural test for the storage-key builder in ./fileUpload.js.
//
//   node src/lib/fileUpload.test.js
//
// WHY this exists: the whole file-attachment feature was broken by one line
// that looked obviously correct — using the picked file's name as the Storage
// object key. Storage validates keys server-side against a fixed character set
// and Hebrew is not in it, so in a Hebrew-language CRM essentially every
// upload failed with "Invalid key". The bug is invisible in review and
// invisible in testing with ASCII file names; it only shows up the moment a
// real user picks a real file. So the key assertion below is the real
// server-side regex, applied to the names people here actually pick.

import assert from 'node:assert/strict';
import {
  buildStorageKey, contentTypeFor, fileExtension, safeFileStem, storageErrorMessage,
} from './fileUpload.js';

// storage-api's isValidKey, verbatim (supabase/storage-api src/storage/limits.ts).
// Note the \w: no Unicode flag, so it means [A-Za-z0-9_] and nothing else.
const isValidKey = (key) =>
  key.length > 0 && /^(\w|\/|!|-|\.|\*|'|\(|\)| |&|\$|@|=|;|:|\+|,|\?)*$/.test(key);

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

console.log('\nbuildStorageKey — keys Storage will accept');

test('a Hebrew file name produces a valid key (the original bug)', () => {
  const key = buildStorageKey('הצעת מחיר ללקוח.pdf');
  assert.ok(isValidKey(key), `Storage would reject "${key}"`);
  assert.ok(key.endsWith('.pdf'), 'extension must survive — greenApiSend types the message from it');
});

test('every name a rep might realistically pick stays valid', () => {
  const names = [
    'תמונה של המיטה.JPG',
    'חשבונית #1234 (עותק).pdf',
    'מפרט טכני – דגם קינג.docx',
    'Quote 50% off.pdf',
    'file with spaces.png',
    'emoji 📎 attachment.pdf',
    'no-extension-at-all',
    '.hiddenfile',
    'שם ארוך מאוד '.repeat(20) + '.pdf',
  ];
  for (const name of names) {
    const key = buildStorageKey(name);
    assert.ok(isValidKey(key), `Storage would reject "${key}" (from "${name}")`);
  }
});

test('a fully Hebrew name still yields a unique, non-empty key', () => {
  const a = buildStorageKey('קובץ.pdf');
  const b = buildStorageKey('קובץ.pdf');
  assert.ok(isValidKey(a) && isValidKey(b));
  assert.notEqual(a, b, 'two uploads of the same name must not collide');
});

test('a name cannot steer the key into another path', () => {
  // '/' and '.' are both legal in a Storage key, so a crafted file name is the
  // one way a caller could reach outside the flat namespace uploads live in.
  const key = buildStorageKey('../../etc/passwd.txt');
  assert.ok(!key.includes('/'), key);
  assert.ok(!key.includes('..'), key);
  assert.ok(key.endsWith('.txt'), key);
});

test('the readable stem is kept when the name is already ASCII', () => {
  const key = buildStorageKey('quote-2026.pdf', { unique: 'U1' });
  assert.equal(key, 'U1_quote-2026.pdf');
});

test('extensions are lower-cased, names without one are left alone', () => {
  assert.equal(buildStorageKey('PHOTO.JPEG', { unique: 'U1' }), 'U1_PHOTO.jpeg');
  assert.equal(buildStorageKey('README', { unique: 'U1' }), 'U1_README');
});

console.log('\nfileExtension / safeFileStem');

test('fileExtension reads the last segment only', () => {
  assert.equal(fileExtension('a.b.c.pdf'), 'pdf');
  assert.equal(fileExtension('archive.tar.gz'), 'gz');
  assert.equal(fileExtension('nodot'), '');
  assert.equal(fileExtension('trailing.'), '');
  assert.equal(fileExtension(null), '');
});

test('safeFileStem collapses runs and trims separators', () => {
  assert.equal(safeFileStem('a   b!!!c.pdf'), 'a-b-c');
  assert.equal(safeFileStem('---x---.png'), 'x');
  assert.equal(safeFileStem('קובץ.pdf'), '', 'nothing ASCII survives — that is fine');
});

console.log('\ncontentTypeFor — the empty-type case');

test('the browser type wins when there is one', () => {
  assert.equal(contentTypeFor({ name: 'x.pdf', type: 'application/pdf' }), 'application/pdf');
});

test('an empty type falls back to the extension, not text/plain', () => {
  // Without this, supabase-js labels the upload text/plain and the bucket's
  // MIME allowlist refuses a perfectly valid PDF.
  assert.equal(contentTypeFor({ name: 'quote.pdf', type: '' }), 'application/pdf');
  assert.equal(contentTypeFor({ name: 'IMG_1.HEIC', type: '' }), 'image/heic');
  assert.equal(contentTypeFor({ name: 'clip.mov', type: 'application/octet-stream' }), 'video/quicktime');
});

test('an unknown extension resolves to nothing rather than a wrong guess', () => {
  assert.equal(contentTypeFor({ name: 'thing.xyz', type: '' }), undefined);
});

console.log('\nstorageErrorMessage — Hebrew, actionable');

test('each known Storage failure maps to its own message', () => {
  const cases = [
    [{ message: 'Invalid key: 123_קובץ.pdf' }, 'תווים'],
    [{ message: 'mime type application/msword is not supported' }, 'סוג הקובץ'],
    [{ message: 'The object exceeded the maximum allowed size' }, 'גדול מדי'],
    [{ statusCode: '413', message: 'Payload too large' }, 'גדול מדי'],
    [{ message: 'new row violates row-level security policy' }, 'הרשאה'],
    [{ message: 'Failed to fetch' }, 'חיבור'],
  ];
  for (const [error, expected] of cases) {
    const msg = storageErrorMessage(error);
    assert.ok(msg.includes(expected), `"${msg}" should mention "${expected}"`);
  }
});

test('an unrecognised error is passed through rather than swallowed', () => {
  assert.equal(storageErrorMessage({ message: 'something new' }), 'something new');
  assert.equal(storageErrorMessage(null), 'ההעלאה נכשלה');
});

console.log(failures === 0 ? '\nAll passed.\n' : `\n${failures} failed.\n`);
process.exit(failures === 0 ? 0 : 1);
