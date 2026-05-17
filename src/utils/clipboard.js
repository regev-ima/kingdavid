import { toast } from 'sonner';

// Small wrapper around `navigator.clipboard.writeText` that:
//   1. Stops the click from bubbling into a row-level handler (so e.g.
//      clicking the copy button next to a customer's phone doesn't also
//      open the order detail).
//   2. Shows a Hebrew toast — success ("X הועתק") or failure ("שגיאה
//      בהעתקה") — so the rep gets feedback without an extra modal.
//
// Use directly inside an onClick: `onClick={(e) => copyToClipboard(e, value, 'טלפון')}`.
export async function copyToClipboard(event, text, label = 'טקסט') {
  if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
  if (text === null || text === undefined || text === '') {
    toast.error('אין מה להעתיק');
    return;
  }
  const value = String(text);
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
    } else {
      // Older browsers / non-secure contexts: fall back to a hidden
      // textarea + execCommand('copy'). Keeps the same UX everywhere.
      const ta = document.createElement('textarea');
      ta.value = value;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    toast.success(`${label} הועתק`);
  } catch (err) {
    console.error('copyToClipboard failed', err);
    toast.error('שגיאה בהעתקה');
  }
}
