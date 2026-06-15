import React, { useEffect, useRef, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { compressImage } from '@/lib/imageCompression';
import { Loader2, ImagePlus, X, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';

// Reusable multi-photo uploader for product-problem photos. Used by both the
// rep-facing "open ticket" dialog and the public self-service form.
//
// While a file is uploading we show its local preview thumbnail with a live
// progress overlay (percentage + bar), so the user can see exactly which images
// are still going up and how far along each one is. The underlying storage APIs
// (Supabase Storage / base44 UploadFile) don't emit byte-level progress events,
// so the percentage is an estimate that climbs toward 90% while the request is
// in flight and snaps to 100% on success — standard UX when the transport has
// no progress channel.
//
// Props:
//   value       — array of public image URLs (controlled)
//   onChange    — (urls: string[]) => void
//   disabled    — disable adding/removing
//   max         — max number of photos (default 6)
//   uploadFn    — optional custom uploader returning { file_url }. Defaults to
//                 base44.integrations.Core.UploadFile (authenticated bucket
//                 write). The public form passes its own anon uploader that
//                 writes under the 'service-requests/' prefix.
export default function ServicePhotoUploader({ value = [], onChange, disabled = false, max = 6, uploadFn }) {
  const inputRef = useRef(null);
  // Files currently uploading: [{ id, previewUrl, progress, status }].
  const [pending, setPending] = useState([]);
  const photos = Array.isArray(value) ? value : [];

  const doUpload = uploadFn || (async (file) => base44.integrations.Core.UploadFile({ file }));

  // Authoritative URL list maintained synchronously so concurrent uploads chain
  // their results instead of racing on the (async) parent `value` prop. We only
  // re-sync it from the parent once nothing is in flight.
  const valueRef = useRef(photos);
  useEffect(() => {
    if (pending.length === 0) valueRef.current = Array.isArray(value) ? value : [];
  }, [value, pending.length]);

  // Track preview object-URLs so we can revoke them all on unmount.
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

  const commit = (url) => {
    const next = [...valueRef.current, url];
    valueRef.current = next;
    onChange?.(next);
  };

  const uploadOne = async (file) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const previewUrl = URL.createObjectURL(file);
    updatePending((prev) => [...prev, { id, previewUrl, progress: 5, status: 'uploading' }]);

    // Estimated progress: ease toward 90% while the request is pending.
    const tick = setInterval(() => {
      updatePending((prev) => prev.map((p) =>
        p.id === id && p.status === 'uploading'
          ? { ...p, progress: Math.min(90, p.progress + Math.max(1, Math.round((90 - p.progress) * 0.18))) }
          : p,
      ));
    }, 220);

    try {
      const compressed = await compressImage(file, { maxSizeMB: 0.6, maxWidthOrHeight: 1600 });
      const { file_url } = await doUpload(compressed);
      clearInterval(tick);
      if (!file_url) throw new Error('no_url');
      updatePending((prev) => prev.map((p) => (p.id === id ? { ...p, progress: 100, status: 'done' } : p)));
      commit(file_url);
      // Let the 100% state show briefly, then drop the placeholder (the real
      // thumbnail is now rendered from `value`).
      setTimeout(() => {
        updatePending((prev) => prev.filter((p) => p.id !== id));
        URL.revokeObjectURL(previewUrl);
      }, 450);
    } catch (err) {
      clearInterval(tick);
      console.error('[ServicePhotoUploader] upload failed', err);
      toast.error('העלאת תמונה נכשלה');
      updatePending((prev) => prev.map((p) => (p.id === id ? { ...p, status: 'error' } : p)));
    }
  };

  const handleFiles = (e) => {
    const files = Array.from(e.target.files || []);
    if (e.target) e.target.value = '';
    if (files.length === 0) return;

    const room = max - (photos.length + pendingRef.current.length);
    if (room <= 0) {
      toast.error(`ניתן לצרף עד ${max} תמונות`);
      return;
    }

    const images = files.filter((f) => f.type.startsWith('image/'));
    if (images.length < files.length) toast.error('ניתן להעלות קבצי תמונה בלבד');

    images.slice(0, room).forEach((file) => uploadOne(file));
  };

  const dismissPending = (id) => {
    updatePending((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target) { try { URL.revokeObjectURL(target.previewUrl); } catch { /* noop */ } }
      return prev.filter((p) => p.id !== id);
    });
  };

  const removeAt = (idx) => {
    onChange?.(photos.filter((_, i) => i !== idx));
  };

  const totalCount = photos.length + pending.length;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {/* Already-uploaded photos */}
        {photos.map((url, idx) => (
          <div key={url + idx} className="relative h-20 w-20 rounded-lg overflow-hidden border border-border group">
            <img src={url} alt={`תמונה ${idx + 1}`} className="h-full w-full object-cover" />
            {!disabled && (
              <button
                type="button"
                onClick={() => removeAt(idx)}
                className="absolute top-0.5 right-0.5 h-5 w-5 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                aria-label="הסר תמונה"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        ))}

        {/* In-flight uploads: preview + progress (or error) */}
        {pending.map((p) => (
          <div key={p.id} className="relative h-20 w-20 rounded-lg overflow-hidden border border-border">
            <img src={p.previewUrl} alt="מעלה תמונה" className="h-full w-full object-cover opacity-60" />
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
            <span className="text-[10px]">הוסף תמונה</span>
          </button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        capture="environment"
        className="hidden"
        onChange={handleFiles}
        disabled={disabled}
      />
      <p className="text-xs text-muted-foreground">צרפו תמונות של הבעיה במוצר (עד {max} תמונות).</p>
    </div>
  );
}
