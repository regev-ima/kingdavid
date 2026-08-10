/**
 * Save a Blob to the user's downloads.
 *
 * Why not window.open(url) — the documents used to be uploaded to storage and
 * the resulting URL opened in a new tab. Generating an order PDF takes several
 * seconds (html2canvas → jsPDF → upload), so by the time the tab was asked for,
 * the browser no longer connected it to the click that started it and Chrome's
 * popup blocker silently swallowed it: every press produced a PDF that neither
 * downloaded nor opened.
 *
 * A blob URL handed to a download anchor has no such rule, and it needs no
 * round trip to storage either — the bytes are already in the page.
 *
 * @param {Blob} blob
 * @param {string} fileName Extension included.
 */
export function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer the revoke a tick so Safari finishes the download before the URL dies.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
