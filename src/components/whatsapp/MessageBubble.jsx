import React from 'react';
import { FileText, MapPin, Image as ImageIcon, Video, Mic, Download, Loader2 } from 'lucide-react';
import { bubbleTime } from './whatsappHelpers';

// A single WhatsApp message. Outgoing (our side) → green, aligned to the start
// (right in RTL). Incoming (customer) → white, aligned to the end.
// message._pending marks an optimistic bubble the composer added before the
// server confirmed the send — greyed out with a spinner instead of a time.
export default function MessageBubble({ message }) {
  const outgoing = message.direction === 'outgoing';
  const pending = !!message._pending;

  return (
    <div className={`flex ${outgoing ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[78%] rounded-2xl px-3 py-2 text-sm shadow-sm ${pending ? 'opacity-60' : ''} ${
          outgoing
            ? 'bg-green-100 text-slate-800 rounded-tr-sm'
            : 'bg-white border border-slate-200 text-slate-800 rounded-tl-sm'
        }`}
      >
        <MediaPart message={message} />
        {message.body ? <p className="whitespace-pre-wrap break-words leading-relaxed">{message.body}</p> : null}
        <div className="mt-0.5 flex items-center justify-end gap-1">
          {pending ? (
            <>
              <span className="text-[10px] text-slate-400">נשלחת…</span>
              <Loader2 className="h-2.5 w-2.5 animate-spin text-slate-400" />
            </>
          ) : (
            <span className="text-[10px] text-slate-400">{bubbleTime(message.msg_timestamp || message.created_date)}</span>
          )}
        </div>
      </div>
    </div>
  );
}

function MediaPart({ message }) {
  const { message_type: type, media_url: url, file_name: fileName } = message;
  if (type === 'image' && url) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="block mb-1">
        <img src={url} alt={fileName || 'תמונה'} className="rounded-lg max-h-64 object-cover" loading="lazy" />
      </a>
    );
  }
  if (type === 'video' && url) {
    return <video src={url} controls className="rounded-lg max-h-64 mb-1" />;
  }
  if (type === 'audio' && url) {
    return <audio src={url} controls className="mb-1 w-56" />;
  }
  if (type === 'document' && url) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="mb-1 flex items-center gap-2 rounded-lg bg-black/5 px-2 py-1.5 hover:bg-black/10">
        <FileText className="h-4 w-4 text-slate-500" />
        <span className="text-xs truncate flex-1">{fileName || 'קובץ'}</span>
        <Download className="h-3.5 w-3.5 text-slate-400" />
      </a>
    );
  }
  // Media we can't render inline — show a small typed placeholder.
  const placeholder = {
    image: { icon: ImageIcon, label: 'תמונה' },
    video: { icon: Video, label: 'וידאו' },
    audio: { icon: Mic, label: 'הודעה קולית' },
    document: { icon: FileText, label: 'קובץ' },
    location: { icon: MapPin, label: 'מיקום' },
  }[type];
  if (placeholder && !message.body) {
    const Icon = placeholder.icon;
    return (
      <div className="flex items-center gap-1.5 text-slate-500">
        <Icon className="h-4 w-4" />
        <span className="text-xs">{placeholder.label}</span>
      </div>
    );
  }
  return null;
}
