import React, { useRef, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { compressImage } from '@/lib/imageCompression';
import { Loader2, ImagePlus, X } from 'lucide-react';
import { toast } from 'sonner';

// Reusable multi-photo uploader for product-problem photos. Used by both the
// rep-facing "open ticket" dialog and the public self-service form.
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
  const [uploading, setUploading] = useState(false);
  const photos = Array.isArray(value) ? value : [];

  const doUpload = uploadFn || (async (file) => base44.integrations.Core.UploadFile({ file }));

  const handleFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    if (e.target) e.target.value = '';

    const room = max - photos.length;
    if (room <= 0) {
      toast.error(`ניתן לצרף עד ${max} תמונות`);
      return;
    }
    const toProcess = files.slice(0, room);

    setUploading(true);
    const added = [];
    for (const file of toProcess) {
      if (!file.type.startsWith('image/')) {
        toast.error('ניתן להעלות קבצי תמונה בלבד');
        continue;
      }
      try {
        const compressed = await compressImage(file, { maxSizeMB: 0.6, maxWidthOrHeight: 1600 });
        const { file_url } = await doUpload(compressed);
        if (file_url) added.push(file_url);
      } catch (err) {
        console.error('[ServicePhotoUploader] upload failed', err);
        toast.error('העלאת תמונה נכשלה');
      }
    }
    if (added.length > 0) onChange?.([...photos, ...added]);
    setUploading(false);
  };

  const removeAt = (idx) => {
    onChange?.(photos.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
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

        {!disabled && photos.length < max && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="h-20 w-20 rounded-lg border-2 border-dashed border-border hover:border-primary/50 hover:bg-muted/40 flex flex-col items-center justify-center gap-1 text-muted-foreground transition-colors"
          >
            {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-5 w-5" />}
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
        disabled={disabled || uploading}
      />
      <p className="text-xs text-muted-foreground">צרפו תמונות של הבעיה במוצר (עד {max} תמונות).</p>
    </div>
  );
}
