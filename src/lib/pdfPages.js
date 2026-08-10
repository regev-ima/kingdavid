import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import { base44 } from "@/api/base44Client";

// One A4 sheet at 96dpi, in CSS pixels. 210×297mm is 793.7×1122.5px, rounded up
// to whole pixels — which is why a "full" page canvas comes out a hair TALLER
// than the PDF page it's meant to fill (see PAGE_OVERSHOOT_TOLERANCE_PX).
export const PAGE_WIDTH_PX = 794;
export const PAGE_HEIGHT_PX = 1123;

// A pixel row counts as blank only if every channel is near-white; anti-aliased
// text greys out well below this.
const BLANK_CHANNEL_MIN = 250;

// How far above a hard A4 boundary we'll look for a blank row to break on.
const BREAK_SCAN_PX = 220;

// Rounding slack (see above). Without it, the 0.5px that a full page overshoots
// A4 by gets "sliced" onto a second, blank sheet.
const PAGE_OVERSHOOT_TOLERANCE_PX = 24;

/**
 * Render one or more page elements into an A4 PDF — one PDF page per element.
 *
 * The documents lay themselves out as explicit `.page` boxes (details on sheet
 * one, terms on sheet two) rather than as one tall strip that gets chopped at
 * the A4 line, because chopping cut through the middle of the terms list.
 *
 * Slicing is still here as a safety net: an order with enough line items — or
 * an admin who pastes twenty clauses into הגדרות ← טקסטים ותנאים — overflows
 * its sheet, and an overflowing sheet continues onto the next one, breaking at
 * a blank row so a line of text is never cut in half.
 *
 * @param {HTMLElement[]|HTMLElement} pageElements Page boxes, in print order.
 * @param {{scale?: number}} [options] scale caps at 2× (~190 DPI on A4 — sharp
 *   enough for text) so the synchronous html2canvas pass doesn't freeze the UI.
 * @returns {Promise<import("jspdf").jsPDF>}
 */
export async function renderPagesToPdf(pageElements, { scale = 2 } = {}) {
  const pages = (Array.isArray(pageElements) ? pageElements : [pageElements]).filter(Boolean);
  if (!pages.length) throw new Error("PDF root element not found");

  const pdf = new jsPDF("p", "mm", "a4");
  const pdfWidth = pdf.internal.pageSize.getWidth();
  const pdfHeight = pdf.internal.pageSize.getHeight();

  const sliceCanvas = document.createElement("canvas");
  const sliceCtx = sliceCanvas.getContext("2d");
  let printed = 0;

  const addSheet = (source, sy, height, pxPerMm) => {
    let imgData;
    if (sy === 0 && height === source.height) {
      imgData = source.toDataURL("image/png", 1.0); // whole page — no copy needed
    } else {
      sliceCanvas.width = source.width;
      sliceCanvas.height = height;
      sliceCtx.clearRect(0, 0, sliceCanvas.width, sliceCanvas.height);
      sliceCtx.drawImage(source, 0, sy, source.width, height, 0, 0, source.width, height);
      imgData = sliceCanvas.toDataURL("image/png", 1.0);
    }
    if (printed > 0) pdf.addPage();
    // Each sheet's image is exactly its own content height (placed at the top of
    // the A4 page), so nothing gets stretched and the rest stays white.
    const heightMm = Math.min(height / pxPerMm, pdfHeight);
    pdf.addImage(imgData, "PNG", 0, 0, pdfWidth, heightMm, undefined, "FAST");
    printed += 1;
  };

  for (const pageEl of pages) {
    const canvas = await html2canvas(pageEl, {
      scale,
      useCORS: true,
      allowTaint: false,
      backgroundColor: "#ffffff",
      logging: false,
      windowWidth: PAGE_WIDTH_PX,
    });

    const pxPerMm = canvas.width / pdfWidth;
    const sheetHeightPx = Math.floor(pdfHeight * pxPerMm);

    // The common case: the page box fits its sheet. No slicing, no blank tail.
    if (canvas.height <= sheetHeightPx + PAGE_OVERSHOOT_TOLERANCE_PX) {
      addSheet(canvas, 0, canvas.height, pxPerMm);
      continue;
    }

    // Read all pixels once so a break can be backed up to a blank row.
    let fullData = null;
    try {
      fullData = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    } catch {
      fullData = null;
    }
    const isBlankRow = (ry) => {
      if (!fullData) return false;
      const base = ry * canvas.width * 4;
      for (let x = 0; x < canvas.width; x++) {
        const i = base + x * 4;
        if (fullData[i] < BLANK_CHANNEL_MIN || fullData[i + 1] < BLANK_CHANNEL_MIN || fullData[i + 2] < BLANK_CHANNEL_MIN) {
          return false;
        }
      }
      return true;
    };
    // Nearest blank row at/above targetY; fall back to the hard boundary when
    // the sheet is genuinely full of ink.
    const cleanBreak = (targetY) => {
      const limit = Math.max(targetY - BREAK_SCAN_PX, 0);
      for (let ry = Math.min(targetY, canvas.height - 1); ry >= limit; ry--) {
        if (isBlankRow(ry)) return ry + 1;
      }
      return targetY;
    };

    let y = 0;
    while (y < canvas.height) {
      if (canvas.height - y < 8) break; // nothing meaningful left
      const hardBreak = Math.min(y + sheetHeightPx, canvas.height);
      let breakY = hardBreak >= canvas.height ? canvas.height : cleanBreak(hardBreak);
      if (breakY <= y) breakY = hardBreak; // always make progress
      addSheet(canvas, y, breakY - y, pxPerMm);
      y = breakY;
    }
  }

  return pdf;
}

/**
 * Put a rendered PDF in storage and return its URL.
 *
 * Only for the paths that need a link to hand to someone else — WhatsApp, email
 * or `quote.pdf_url`. A plain "download this" never comes through here: it saves
 * the blob directly (see lib/downloadBlob.js).
 *
 * @param {{blob: Blob, fileName: string}} pdf
 * @returns {Promise<string>}
 */
export async function uploadPdfBlob({ blob, fileName }) {
  const file = new File([blob], fileName, { type: "application/pdf" });
  const uploadRes = await base44.integrations.Core.UploadFile({ file });
  return uploadRes.file_url;
}

/**
 * Mount PDF markup off-screen, hand its `.page` boxes to a callback, and clean
 * up afterwards. Both document generators build their HTML as a string, so the
 * mount/measure/unmount dance is identical for each.
 *
 * @param {string} html Markup containing one or more `.page` elements.
 * @param {(pages: HTMLElement[]) => Promise<T>} run
 * @returns {Promise<T>}
 * @template T
 */
export async function withMountedPages(html, run) {
  const host = document.createElement("div");
  host.innerHTML = html;
  host.style.position = "fixed";
  host.style.left = "-10000px";
  host.style.top = "0";
  host.style.width = `${PAGE_WIDTH_PX}px`;
  host.style.zIndex = "-1";
  document.body.appendChild(host);
  try {
    return await run(Array.from(host.querySelectorAll(".page")));
  } finally {
    document.body.removeChild(host);
  }
}
