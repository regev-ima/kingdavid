-- Widen the 'uploads' bucket's MIME allowlist to what the app's file pickers
-- actually offer.
--
-- The bucket was created (20240201000001) allowing seven types: pdf, png, jpeg,
-- gif, webp, csv, xlsx. Every picker in the app has since grown past that list,
-- and Storage rejects anything outside it — so these were all failing at the
-- bucket, after the user had already waited through the upload:
--
--   * Word / PowerPoint / plain text — offered by the WhatsApp composer's
--     `accept` attribute, refused by the bucket. The picker said yes, the
--     server said no.
--   * iPhone photos (image/heic, image/heif). Safari hands these over as-is
--     from `image/*`; on the sending side the composer now converts them to
--     JPEG, but the public service-request form uploads straight through.
--   * Video of any kind — which means ServicePhotoUploader's video support
--     (size- and duration-capped in the client since the service centre
--     shipped) could never once have succeeded in production.
--
-- Not added, on purpose:
--   * image/svg+xml — an SVG is a script container, and this bucket is world
--     readable. Nothing in the app needs to upload one.
--   * application/octet-stream — the browser's "I don't know" type. Allowing it
--     would let anything through and make the allowlist decorative; the client
--     resolves a real type from the extension instead (src/lib/fileUpload.js).
--
-- file_size_limit stays at 50MB. The client caps documents at the same number
-- (MAX_UPLOAD_MB) and shrinks oversized photos below it, so the two agree —
-- the previous mismatch (client allowed 100MB, bucket took 50MB) turned a
-- 60MB PDF into an opaque failure halfway through the upload.
--
-- Idempotent: re-running just re-asserts the same allowlist.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'uploads', 'uploads', true, 52428800,
  ARRAY[
    -- Documents
    'application/pdf',
    'text/csv',
    'text/plain',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    -- Images
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'image/heic',
    'image/heif',
    'image/avif',
    'image/bmp',
    'image/tiff',
    -- Short videos (service-request problem clips)
    'video/mp4',
    'video/quicktime',
    'video/webm',
    'video/3gpp'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public             = EXCLUDED.public,
  file_size_limit    = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;
