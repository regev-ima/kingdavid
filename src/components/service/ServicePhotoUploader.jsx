import React, { useEffect, useRef, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { compressImage } from '@/lib/imageCompression';
import { Loader2, ImagePlus, X, AlertCircle, Play } from 'lucide-react';
import { toast } from 'sonner';
import {
  UPLOAD_ACCEPT, UPLOAD_MAX_IMAGE_MB, UPLOAD_MAX_VIDEO_MB, UPLOAD_MAX_VIDEO_SECONDS,
} from '@/constants/serviceOptions';

// Reusable media uploader for product-problem photos AND short videos. Used by
// the rep "open ticket" dialog, the public self-service form, and the ticket
// detail view.
//
// - Each in-flight file shows a live preview thumbnail with an estimated upload
//   percentage (the storage APIs don't emit byte progress).
// - Every committed item has an always-visible delete badge; removing it also
//   best-effort deletes the underlying object from Storage so we don't leak
//   files.
// - Only images / short videos are accepted, capped by size (and videos by
//   duration) — a UX guard on top of the storage RLS policy.
//
// Props:
//   value             — array of public media URLs (controlled)
//   onChange          — (urls: string[]) => void
//   disabled          — disable adding/removing
//   max               — max number of files (default 6)
//   uploadFn          — optional custom uploader returning { file_url }.
//   deleteFn          — optional override for removing a URL from storage.
//   onUploadingChange — (isUploading: bool) => void, so the parent can block
//                       submit while files are still going up.

const VIDEO_URL_RE = /\.(mp4|mov|webm|m4v|avi|3gp|ogg|quicktime)(\?|#|$)/i;
const isVideoUrl = (u) => VIDEO_URL_RE.test(String(u || ''));

// Best-effort delete of a Supabase public-storage URL: parse "bucket/path" out
// of the public URL and remove it. Silently ignores failures (e.g. RLS denies)
// so the UI removal always succeeds.
async function defaultDeleteFromStorage(url) {
  try {
    const marker = '/storage/v1/object/public/';
    const i = String(url).indexOf(marker);
    if (i === -1) return;
    const rest = url.slice(i + marker.length);
    const slash = rest.indexOf('/');
    if (slash === -1) return;
    const bucket = rest.slice(0, slash);
    const path = decodeURIComponent(rest.slice(slash + 1).split(/[?#]/)[0]);
    await base44.supabase.storage.from(bucket).remove([path]);
  } catch (err) {
    console.warn('[ServicePhotoUploader] storage delete failed (best-effort)', err);
  }
}

// Read a video file's duration (seconds) from its metadata. Returns 0 when it
// can't be determined, in which case we don't block the upload.
function getVideoDurationSeconds(file) {
  return new Promise((resolve) => {
    try {
      const url = URL.createObjectURL(file);
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve(Number.isFinite(v.duration) ? v.duration : 0); };
      v.onerror = () => { URL.revokeObjectURL(url); resolve(0); };
      v.src = url;
    } catch { resolve(0); }
  });
}

// Validate type/size/duration. Returns an error string, or null when OK.
async function validateFile(file) {
  const isImage = file.type.startsWith('image/');
  const isVideo = file.type.startsWith('video/');
  if (!isImage && !isVideo) return 'ניתן להעלות תמונות או סרטונים קצרים בלבד';
  const mb = file.size / (1024 * 1024);
  if (isImage && mb > UPLOAD_MAX_IMAGE_MB) return `התמונה גדולה מדי (עד ${UPLOAD_MAX_IMAGE_MB}MB)`;
  if (isVideo && mb > UPLOAD_MAX_VIDEO_MB) return `הסרטון גדול מדי (עד ${UPLOAD_MAX_VIDEO_MB}MB)`;
  if (isVideo) {
    const dur = await getVideoDurationSeconds(file);
    if (dur && dur > UPLOAD_MAX_VIDEO_SECONDS) return `הסרטון ארוך מדי (עד ${UPLOAD_MAX_VIDEO_SECONDS} שניות)`;
  }
  return null;
}

export default function ServicePhotoUploader({
  value = [], onChange, disabled = false, max = 6, uploadFn, deleteFn, onUploadingChange,
}) {
  const inputRef = useRef(null);
  // Files currently uploading: [{ id, previewUrl, progress, status, isVideo }].
  const [pending, setPending] = useState([]);
  const photos = Array.isArray(value) ? value : [];

  const doUpload = uploadFn || (async (file) => base44.integrations.Core.UploadFile({ file }));
  const doDelete = deleteFn || defaultDeleteFromStorage;

  // Authoritative URL list maintained synchronously so concurrent uploads chain
  // their results instead of racing on the (async) parent `value` prop.
  const valueRef = useRef(photos);
  useEffect(() => {
    if (pending.length === 0) valueRef.current = Array.isArray(value) ? value : [];
  }, [value, pending.length]);

  const pendingRef = useRef([]);
  const updatePending = (updater) => {
    setPending((prev) => {
      const next = updater(prev);
      pendingRef.current = next;
      return next;
    });
  };
  useEffect(() => () => {
    pendingRef.current.forEach((p) => { try { URL.revokeObjectURL(p.previewUrl); } catch { /* noop */ } });
  }, []);

  // Tell the parent whether anything is still uploading (to block submit).
  const onUploadingChangeRef = useRef(onUploadingChange);
  onUploadingChangeRef.current = onUploadingChange;
  const uploadingCount = pending.filter((p) => p.status === 'uploading').length;
  useEffect(() => { onUploadingChangeRef.current?.(uploadingCount > 0); }, [uploadingCount]);

  const commit = (url) => {
    const next = [...valueRef.current, url];
    valueRef.current = next;
    onChange?.(next);
  };

  const uploadOne = async (file) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const isVideo = file.type.startsWith('video/');
    const previewUrl = URL.createObjectURL(file);
    updatePending((prev) => [...prev, { id, previewUrl, progress: 5, status: 'uploading', isVideo }]);

    const tick = setInterval(() => {
      updatePending((prev) => prev.map((p) =>
        p.id === id && p.status === 'uploading'
          ? { ...p, progress: Math.min(90, p.progress + Math.max(1, Math.round((90 - p.progress) * 0.18))) }
          : p,
      ));
    }, 220);

    try {
      // Images get compressed; videos upload as-is (already size/duration-capped).
      const toSend = isVideo ? file : await compressImage(file, { maxSizeMB: 0.6, maxWidthOrHeight: 1600 });
      const { file_url } = await doUpload(toSend);
      clearInterval(tick);
      if (!file_url) throw new Error('no_url');
      updatePending((prev) => prev.map((p) => (p.id === id ? { ...p, progress: 100, status: 'done' } : p)));
      commit(file_url);
      setTimeout(() => {
        updatePending((prev) => prev.filter((p) => p.id !== id));
        URL.revokeObjectURL(previewUrl);
      }, 450);
    } catch (err) {
      clearInterval(tick);
      console.error('[ServicePhotoUploader] upload failed', err);
      toast.error('ההעלאה נכשלה');
      updatePending((prev) => prev.map((p) => (p.id === id ? { ...p, status: 'error' } : p)));
    }
  };

  const handleFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    if (e.target) e.target.value = '';
    if (files.length === 0) return;

    const room = max - (photos.length + pendingRef.current.length);
    if (room <= 0) {
      toast.error(`ניתן לצרף עד ${max} קבצים`);
      return;
    }

    let used = 0;
    for (const file of files) {
      if (used >= room) { toast.error(`ניתן לצרף עד ${max} קבצים`); break; }
      const err = await validateFile(file);
      if (err) { toast.error(err); continue; }
      used += 1;
      uploadOne(file);
    }
  };

  const dismissPending = (id) => {
    updatePending((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target) { try { URL.revokeObjectURL(target.previewUrl); } catch { /* noop */ } }
      return prev.filter((p) => p.id !== id);
    });
  };

  const removeAt = (idx) => {
    const url = photos[idx];
    onChange?.(photos.filter((_, i) => i !== idx));
    if (url) doDelete(url); // fire-and-forget storage cleanup
  };

  const totalCount = photos.length + pending.length;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {/* Already-uploaded media */}
        {photos.map((url, idx) => (
          <div key={url + idx} className="relative h-20 w-20 rounded-lg overflow-hidden border border-border">
            {isVideoUrl(url) ? (
              <>
                <video src={url} className="h-full w-full object-cover" muted playsInline preload="metadata" />
                <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <span className="h-6 w-6 rounded-full bg-black/55 flex items-center justify-center"><Play className="h-3.5 w-3.5 text-white" /></span>
                </span>
              </>
            ) : (
              <img src={url} alt={`קובץ ${idx + 1}`} className="h-full w-full object-cover" />
            )}
            {!disabled && (
              <button
                type="button"
                onClick={() => removeAt(idx)}
                className="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-black/65 text-white flex items-center justify-center hover:bg-red-600 transition-colors"
                aria-label="הסר קובץ"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        ))}

        {/* In-flight uploads: preview + progress (or error) */}
        {pending.map((p) => (
          <div key={p.id} className="relative h-20 w-20 rounded-lg overflow-hidden border border-border">
            {p.isVideo
              ? <video src={p.previewUrl} className="h-full w-full object-cover opacity-60" muted playsInline preload="metadata" />
              : <img src={p.previewUrl} alt="מעלה" className="h-full w-full object-cover opacity-60" />}
            {p.status === 'error' ? (
              <div className="absolute inset-0 bg-red-900/55 flex flex-col items-center justify-center gap-1 text-white">
                <AlertCircle className="h-4 w-4" />
                <button type="button" onClick={() => dismissPending(p.id)} className="text-[10px] underline">הסר</button>
              </div>
            ) : (
              <div className="absolute inset-0 bg-black/45 flex flex-col items-center justify-center gap-1">
                <Loader2 className="h-4 w-4 animate-spin text-white" />
                <span className="text-[11px] font-semibold text-white tabular-nums">{p.progress}%</span>
                <div className="absolute bottom-0 inset-x-0 h-1 bg-white/30">
                  <div className="h-full bg-primary transition-all duration-200" style={{ width: `${p.progress}%` }} />
                </div>
              </div>
            )}
          </div>
        ))}

        {!disabled && totalCount < max && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="h-20 w-20 rounded-lg border-2 border-dashed border-border hover:border-primary/50 hover:bg-muted/40 flex flex-col items-center justify-center gap-1 text-muted-foreground transition-colors"
          >
            <ImagePlus className="h-5 w-5" />
            <span className="text-[10px]">הוסף קובץ</span>
          </button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={UPLOAD_ACCEPT}
        multiple
        capture="environment"
        className="hidden"
        onChange={handleFiles}
        disabled={disabled}
      />
      <p className="text-xs text-muted-foreground">
        צרפו תמונות או סרטון קצר של הבעיה (עד {max} קבצים · סרטון עד {UPLOAD_MAX_VIDEO_SECONDS} שניות).
      </p>
    </div>
  );
}
