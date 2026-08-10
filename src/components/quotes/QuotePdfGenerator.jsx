import { base44 } from "@/api/base44Client";
import { format } from "@/lib/safe-date-fns";
import { bedConfigFieldLines } from "@/lib/bedConfig";
import { DOCUMENT_TERMS_LABELS, resolveDocumentTerms } from "@/constants/documentTerms";
import { fetchDocumentTermsSetting } from "@/lib/documentTermsSettings";
import { renderPagesToPdf, uploadPdfBlob, withMountedPages } from "@/lib/pdfPages";

/**
 * KING DAVID - Premium PDF Quote Generator
 *
 * Renders the quote and hands back the bytes. Split out from the default
 * export because "צור PDF" wants the file itself, not a link to it — uploading
 * first and then opening the URL lost the file to the popup blocker (see
 * lib/downloadBlob.js).
 *
 * @returns {Promise<{blob: Blob, fileName: string}>}
 */
export const buildQuotePdfBlob = async (quoteData) => {
  const logoUrl = "https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/6956450f0d239229ec5ea53f/0de0b7ac4_image.png";

  const safe = (v) => (v === null || v === undefined ? "" : String(v));

  // Who gave the quote. The quote stores the rep's email (`created_by_rep`);
  // the customer's copy should carry their name, so resolve it and fall back to
  // the email — a document that names the rep by address still beats one that
  // doesn't say who to call back.
  let repName = safe(quoteData.created_by_rep);
  if (quoteData.created_by_rep) {
    try {
      const repRows = await base44.entities.User.filter({ email: quoteData.created_by_rep }, null, 1);
      if (repRows?.[0]?.full_name) repName = repRows[0].full_name;
    } catch {
      // keep the email
    }
  }

  // HTML-escape a value before interpolating it into the document so the
  // user-written notes / terms can't accidentally break out of the surrounding
  // markup (e.g. a literal "<" in a note).
  const esc = (v) =>
    safe(v)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  // The default notes block is a multi-line list (each bullet on its own line
  // separated by \n, with leading "*" markers). The PDF used to dump the whole
  // string into one <p> with font-weight:900 — so it rendered as one bold wall
  // of text.
  //
  // We avoid <ul>/<li> here on purpose: html2canvas (the HTML→canvas pipeline
  // that produces the PDF) doesn't reliably render the native list marker on
  // the RTL side — the bullets ended up flush left while the text was flush
  // right, looking like two disconnected columns. Rendering a literal "•"
  // inline at the start of each line keeps the marker right next to its text
  // regardless of how the renderer handles list-style.
  const formatNotesAsList = (raw) => {
    const lines = String(raw || "")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) return "";
    return lines
      .map((line) => esc(line.replace(/^\*\s*/, "")))
      .map((line) => `<div class="terms-item"><span class="terms-bullet">•</span><span>${line}</span></div>`)
      .join("");
  };

  // Terms / warranty are short free text rather than a bullet list — keep the
  // author's line breaks instead of collapsing them into one run-on line.
  const escMultiline = (v) => esc(v).replace(/\r?\n/g, "<br/>");

  // The three legal texts, always printed: a quote saved before these fields
  // existed falls back to the company defaults (הגדרות ← טקסטים ותנאים) and
  // then to the text in code, so an old quote prints the same document a new
  // one does instead of dropping the terms entirely.
  const companyTermsDefaults = (await fetchDocumentTermsSetting())?.value || null;
  const printedTerms = resolveDocumentTerms(quoteData, companyTermsDefaults);

  const normalizeNumber = (n) => {
    const x = Number(n);
    return Number.isFinite(x) ? x : 0;
  };

  const money = (n) => {
    const num = normalizeNumber(n);
    // Two decimals (agorot) so line amounts sum exactly to the printed total.
    return `₪${num.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const createdDate = quoteData?.created_date
    ? format(new Date(quoteData.created_date), "dd/MM/yyyy")
    : "";
  const validUntil = quoteData?.valid_until
    ? format(new Date(quoteData.valid_until), "dd/MM/yyyy")
    : "";

  const customerAddress = `${safe(quoteData.delivery_address)}${
    quoteData.delivery_city ? `, ${safe(quoteData.delivery_city)}` : ""
  }`.trim();

  // A self-pickup quote carries no delivery charge, so it must not imply a
  // delivery either: the address line becomes the pickup statement.
  const selfPickup = Boolean(quoteData.is_self_pickup);

  const items = Array.isArray(quoteData.items) ? quoteData.items : [];
  const extras = Array.isArray(quoteData.extras) ? quoteData.extras : [];

  const rows = [
    ...items.map((item, idx) => {
      const addonsTotal = (item?.selected_addons || []).reduce((sum, addon) => sum + normalizeNumber(addon?.price), 0);
      const totalUnitPrice = normalizeNumber(item?.unit_price) + addonsTotal;
      const hasAddons = (item?.selected_addons || []).length > 0;
      const hasSize = item?.length_cm && item?.width_cm;
      
      let extraInfo = [];
      if (hasSize) {
        extraInfo.push(`מידה: ${item.length_cm}×${item.width_cm}${item.height_cm ? `×${item.height_cm}` : ''} ס"מ`);
      }
      if (hasAddons) {
        const addonsText = (item.selected_addons || []).map(a => `${a.name} (+₪${normalizeNumber(a.price).toLocaleString()})`).join(', ');
        extraInfo.push(`תוספות: ${addonsText}`);
      }
      // Bed text-question answers (fabric catalog etc.) — the generic path.
      // Falls back to legacy fabric_* columns for quotes saved before the feature.
      const fieldLines = bedConfigFieldLines(item);
      if (fieldLines.length) {
        fieldLines.forEach((ln) => extraInfo.push(safe(ln)));
      } else {
        const fabricParts = [];
        if (item?.fabric_catalog_name) fabricParts.push(`קטלוג: ${safe(item.fabric_catalog_name)}`);
        if (item?.fabric_color_number) fabricParts.push(`מס׳ צבע: ${safe(item.fabric_color_number)}`);
        if (item?.fabric_color) fabricParts.push(`צבע: ${safe(item.fabric_color)}`);
        const supplier = item?.fabric_supplier === 'אחר'
          ? (item?.fabric_supplier_other || 'אחר')
          : item?.fabric_supplier;
        if (supplier) fabricParts.push(`ספק: ${safe(supplier)}`);
        if (fabricParts.length) {
          extraInfo.push(`בד: ${fabricParts.join(' · ')}`);
        }
      }
      
      return {
        idx: idx + 1,
        name: safe(item?.name),
        sku: safe(item?.sku),
        price: money(totalUnitPrice),
        qty: safe(item?.quantity ?? 1),
        qtyNum: normalizeNumber(item?.quantity ?? 1),
        hasExtraInfo: extraInfo.length > 0,
        extraInfoText: extraInfo.join(' | ')
      };
    }),
    ...extras.map((extra, j) => ({
      idx: items.length + j + 1,
      name: safe(extra?.name),
      sku: "תוספת",
      price: money(extra?.cost),
      qty: "1",
      qtyNum: 1,
      hasAddons: false,
      addonsText: ""
    })),
  ];

  const subtotal = normalizeNumber(quoteData.subtotal);
  const discount = normalizeNumber(quoteData.discount_total);
  const vat = normalizeNumber(quoteData.vat_amount);
  const total = normalizeNumber(quoteData.total);

  const htmlContent = `
  <div dir="rtl" style="font-family: Heebo, Assistant, Arial, sans-serif; background:#F6F8FC; padding:18px;">
    <style>
      @page { size: A4; margin: 0; }
      * { box-sizing: border-box; }

      /* One A4 sheet. Flex column so the footer sits on the bottom edge even on
         the terms sheet, which doesn't fill its page. */
      .page {
        width: 794px;
        min-height: 1123px;
        margin: 0 auto;
        background: #ffffff;
        overflow: hidden;
        box-shadow: 0 10px 34px rgba(16,24,40,.12);
        display: flex;
        flex-direction: column;
      }
      .page + .page { margin-top: 18px; }

      /* Header (Black) for Gold Logo */
      .topbar {
        padding: 18px 22px;
        background: #0B0B0B;
        color: #F3F4F6;
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap: 16px;
        border-bottom: 1px solid #1F2933;
      }

      .brand { display:flex; flex-direction:column; gap: 2px; }
      .brand h1 { margin:0; font-size: 18px; font-weight: 900; letter-spacing:.2px; }
      .brand .sub { margin:0; font-size: 11px; opacity: .82; font-weight: 700; }

      .logoWrap { display:flex; align-items:center; justify-content:center; flex: 1; }
      .logo {
        height: 46px;
        width: auto;
        background: transparent;
        padding: 0;
        filter: none;
      }

      .content { padding: 18px 22px 14px; flex: 1; }

      .titleRow {
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap: 12px;
        margin-bottom: 12px;
      }
      .title { font-size: 16px; font-weight: 900; margin: 0; color: #0B1220; }
      .titleWithNumber { display:flex; align-items:center; gap: 12px; }
      .quoteNum { font-size: 14px; font-weight: 700; color: #667085; }
      .meta { display:flex; gap: 12px; flex-wrap: wrap; justify-content:flex-start; font-size: 11px; color: #667085; font-weight: 700; }

      .grid { display:grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px; }
      .card {
        border: 1px solid #E8ECF4;
        background: #FFFFFF;
        border-radius: 14px;
        padding: 12px;
      }
      .cardTitle {
        font-size: 11px;
        font-weight: 900;
        color: #111827;
        margin: 0 0 8px 0;
        display:flex;
        align-items:center;
        justify-content:space-between;
      }

      .kv {
        display:grid;
        grid-template-columns: 84px 1fr;
        row-gap: 6px;
        column-gap: 10px;
        font-size: 11px;
        color: #0B1220;
      }
      .k { color:#667085; font-weight:900; }
      .v { font-weight:900; }

      .divider { height:1px; background: #EEF2F7; margin: 12px 0; }

      table {
        width:100%;
        border-collapse: separate;
        border-spacing: 0;
        overflow:hidden;
        border: 1px solid #E8ECF4;
        border-radius: 14px;
      }
      thead th {
        background: #111827;
        color: #fff;
        font-size: 10px;
        font-weight: 900;
        padding: 6px 9px;
        text-align: right;
        border-left: 1px solid rgba(255,255,255,.08);
        white-space: nowrap;
      }
      thead th:last-child { border-left: none; }
      tbody td {
        font-size: 10px;
        padding: 6px 9px;
        border-top: 1px solid #EEF2F7;
        color: #0B1220;
        font-weight: 900;
      }
      tbody tr:nth-child(even) td { background:#FAFBFF; }

      .center { text-align:center; }
      .muted { color:#667085; font-weight: 900; }
      .highlight { background:#FEF08A !important; }

      .summaryRow {
        display:grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
        margin-top: 12px;
        align-items: stretch;
      }

      .totals {
        border: 1px solid #E8ECF4;
        border-radius: 14px;
        padding: 12px;
        background: linear-gradient(180deg, #FFFFFF 0%, #FAFBFF 100%);
      }
      .totals .line {
        display:flex;
        justify-content:space-between;
        font-size: 11px;
        padding: 6px 0;
        color:#0B1220;
        font-weight: 900;
      }
      .totals .line .label { color:#667085; font-weight:900; }
      .totals .line.total {
        border-top: 1px dashed #D8DEEA;
        margin-top: 6px;
        padding-top: 10px;
        font-size: 12px;
      }
      .discount { color:#B42318; }

      .sig {
        border: 1px solid #E8ECF4;
        border-radius: 14px;
        padding: 12px;
        background:#fff;
        display:flex;
        flex-direction:column;
        justify-content:space-between;
        min-height: 110px;
      }
      .sig .label { font-size: 11px; font-weight: 900; color:#111827; margin:0; }
      .sig .line { margin-top: 42px; border-bottom: 2px solid #111827; opacity: .18; }
      .sig .hint { margin:8px 0 0; font-size: 10px; color:#667085; font-weight:900; text-align:center; }

      .notes {
        margin-top: 8px;
        border: 1px solid #E8ECF4;
        background: #FFFFFF;
        border-radius: 14px;
        padding: 8px 12px;
        font-size: 9px;
        color:#0B1220;
        font-weight: 400;
        line-height: 1.4;
      }
      .notes p { margin: 0 0 3px 0; font-weight: 400; }
      .notes p:last-child { margin:0; }
      .notes-label {
        font-weight: 700;
        margin: 0 0 6px 0;
        color: #111827;
      }
      /* The legal texts get a sheet of their own, so they get readable type
         (11px) instead of the 9px they were squeezed to when everything had to
         fit under the totals. */
      .terms {
        margin-top: 10px;
        border: 1px solid #E8ECF4;
        background: #FFFFFF;
        border-radius: 14px;
        padding: 10px 14px;
        font-size: 11px;
        color: #0B1220;
        font-weight: 400;
        line-height: 1.65;
      }
      .terms p { margin: 0 0 4px 0; font-weight: 400; }
      .terms p:last-child { margin: 0; }
      .terms-label {
        font-size: 12px;
        font-weight: 900;
        margin: 0 0 8px 0;
        color: #111827;
      }
      .terms-item {
        display: flex;
        flex-direction: row;
        align-items: flex-start;
        gap: 8px;
        margin: 0 0 6px 0;
        font-weight: 400;
        text-align: right;
      }
      .terms-item:last-child { margin: 0; }
      .terms-bullet {
        flex: 0 0 auto;
        color: #4B5563;
        line-height: 1.65;
      }

      .footer {
        padding: 10px 22px 14px;
        color:#667085;
        font-size: 10px;
        font-weight: 900;
        text-align:center;
      }
      .footer .row { margin: 2px 0; }
    </style>

    <!-- Sheet 1 — the quote itself: who, what, how much. -->
    <div class="page" id="quote-page">
      <div class="topbar">
        <div class="brand">
          <h1>המלך דוד</h1>
          <p class="sub">תעשיות מזרנים בע״מ</p>
        </div>

        <div class="logoWrap">
          <img class="logo" src="${logoUrl}" alt="King David Logo" />
        </div>

        <div style="text-align:left; font-size:11px; font-weight:900; opacity:.92;">
          <div>ח.פ. 512052960</div>
          <div>עוסק מורשה: 812082980</div>
        </div>
      </div>

      <div class="content">
        <div class="titleRow">
          <div class="titleWithNumber">
            <h2 class="title">הצעת מחיר</h2>
            <span class="quoteNum">#${safe(quoteData.quote_number)}</span>
          </div>
          <div class="meta">
            <span>תאריך: ${createdDate}</span>
            ${validUntil ? `<span>תוקף: ${validUntil}</span>` : ""}
            <span>סניף: ראשון לציון</span>
          </div>
        </div>

        <div class="grid">
          <div class="card">
            <div class="cardTitle">
              <span>פרטי לקוח</span>
              ${safe(quoteData.customer_phone) ? `<span class="muted">${safe(quoteData.customer_phone)}</span>` : ""}
            </div>
            <div class="kv">
              <div class="k">שם ושם משפחה</div><div class="v">${safe(quoteData.customer_name)}</div>
              ${
                selfPickup
                  ? `<div class="k">אופן אספקה</div><div class="v" style="font-weight:700;">איסוף עצמי - בתיאום</div>
                     <div class="k">מקום האיסוף</div><div class="v">רחוב העמל 6, קרית מלאכי · א׳-ה׳ 9:00-16:00</div>`
                  : `<div class="k">כתובת</div><div class="v">${safe(customerAddress)}</div>
              ${safe(quoteData.floor) ? `<div class="k">קומה</div><div class="v">${safe(quoteData.floor)}</div>` : ""}`
              }
            </div>
          </div>

          <div class="card">
            <div class="cardTitle">
              <span>פרטי מסמך</span>
              <span class="muted">#${safe(quoteData.quote_number)}</span>
            </div>
            <div class="kv">
              <div class="k">מס׳ הצעה</div><div class="v">${safe(quoteData.quote_number)}</div>
              <div class="k">תאריך</div><div class="v">${createdDate}</div>
              ${validUntil ? `<div class="k">תוקף</div><div class="v">${validUntil}</div>` : ""}
              ${repName ? `<div class="k">נציג מטפל</div><div class="v">${esc(repName)}</div>` : ""}
              <div class="k">סטטוס</div><div class="v">טיוטה / להצגה</div>
            </div>
          </div>
        </div>

        <div class="divider"></div>

        <table>
          <thead>
            <tr>
              <th class="center" style="width:42px;">#</th>
              <th>שם פריט</th>
              <th class="center" style="width:110px;">קוד</th>
              <th class="center" style="width:90px;">מחיר לפני מע״מ</th>
              <th class="center" style="width:70px;">כמות</th>
            </tr>
          </thead>
          <tbody>
            ${
              rows.length
                ? rows
                    .map(
                      (r) => `
                <tr>
                  <td class="center">${r.idx}</td>
                  <td>
                    ${r.name}
                    ${r.hasExtraInfo ? `<div style="font-size:9px; color:#667085; margin-top:2px;">${r.extraInfoText}</div>` : ''}
                  </td>
                  <td class="center muted">${r.sku}</td>
                  <td class="center">${r.price}</td>
                  <td class="center${r.qtyNum >= 2 ? ' highlight' : ''}">${r.qty}</td>
                </tr>
              `
                    )
                    .join("")
                : `
                <tr>
                  <td class="center">1</td>
                  <td>—</td>
                  <td class="center muted">—</td>
                  <td class="center">—</td>
                  <td class="center">—</td>
                </tr>
              `
            }
          </tbody>
        </table>

        <div class="summaryRow">
          <div class="sig">
            <p class="label">חתימת לקוח</p>
            <div class="line"></div>
            <p class="hint">חתימה</p>
          </div>

          <div class="totals">
            <div class="line"><span class="label">סכום ביניים לפני מע״מ</span><span>${money(subtotal)}</span></div>
            ${
              discount > 0
                ? `<div class="line"><span class="label discount">הנחה</span><span class="discount">-${money(discount)}</span></div>`
                : ""
            }
            <div class="line"><span class="label">מע״מ</span><span>${money(vat)}</span></div>
            <div class="line total"><span class="label">סה״כ לתשלום</span><span>${money(total)}</span></div>
          </div>
        </div>

        ${
          Array.isArray(quoteData.payment_terms_selection) && quoteData.payment_terms_selection.length
            ? `
          <div class="notes">
            <p class="notes-label">אמצעי תשלום:</p>
            <p>${quoteData.payment_terms_selection.map(esc).join(' · ')}</p>
          </div>
        `
            : ""
        }

        ${
          quoteData.special_requests
            ? `
          <div class="notes">
            <p class="notes-label">בקשות מיוחדות:</p>
            <p>${esc(quoteData.special_requests)}</p>
          </div>
        `
            : ""
        }

      </div>

      <div class="footer">
        <div class="row">משרדים וחנות המפעל – רח׳ בן צבי 23 ראשל״צ</div>
        <div class="row">כתובת מפעל החברה: רחוב העמל 6 קרית מלאכי</div>
        <div class="row">טל: 1700-700-464, פקס: 03-9622319</div>
      </div>
    </div>

    <!-- Sheet 2 — the legal texts. They used to trail the totals on sheet 1 and
         get chopped mid-clause wherever the A4 line happened to fall; on a
         sheet of their own they read in full, at a size a customer can read. -->
    <div class="page" id="quote-page-terms">
      <div class="topbar">
        <div class="brand">
          <h1>המלך דוד</h1>
          <p class="sub">תעשיות מזרנים בע״מ</p>
        </div>

        <div class="logoWrap">
          <img class="logo" src="${logoUrl}" alt="King David Logo" />
        </div>

        <div style="text-align:left; font-size:11px; font-weight:900; opacity:.92;">
          <div>ח.פ. 512052960</div>
          <div>עוסק מורשה: 812082980</div>
        </div>
      </div>

      <div class="content">
        <div class="titleRow">
          <div class="titleWithNumber">
            <h2 class="title">תנאי ההצעה</h2>
            <span class="quoteNum">#${safe(quoteData.quote_number)}</span>
          </div>
          <div class="meta">
            ${quoteData.customer_name ? `<span>${esc(quoteData.customer_name)}</span>` : ""}
            <span>תאריך: ${createdDate}</span>
          </div>
        </div>

        <div class="terms">
          <p class="terms-label">${DOCUMENT_TERMS_LABELS.terms}:</p>
          <p>${escMultiline(printedTerms.terms)}</p>
        </div>

        <div class="terms">
          <p class="terms-label">${DOCUMENT_TERMS_LABELS.warranty_terms}:</p>
          <p>${escMultiline(printedTerms.warranty_terms)}</p>
        </div>

        <div class="terms">
          <p class="terms-label">${DOCUMENT_TERMS_LABELS.legal_notes}:</p>
          ${formatNotesAsList(printedTerms.legal_notes)}
        </div>
      </div>

      <div class="footer">
        <div class="row">משרדים וחנות המפעל – רח׳ בן צבי 23 ראשל״צ</div>
        <div class="row">כתובת מפעל החברה: רחוב העמל 6 קרית מלאכי</div>
        <div class="row">טל: 1700-700-464, פקס: 03-9622319</div>
      </div>
    </div>
  </div>
  `;

  // Sheet 1 (quote) then sheet 2 (terms), each rendered onto its own A4 page.
  const pdf = await withMountedPages(htmlContent, (pages) => renderPagesToPdf(pages));

  return {
    blob: pdf.output("blob"),
    fileName: `${safe(quoteData.quote_number) || quoteData.id}.pdf`,
  };
};

/**
 * The same PDF, uploaded — for the paths that need a URL to hand to someone
 * else (WhatsApp, email) or to store on the quote as `pdf_url`.
 * @returns {Promise<string>} the uploaded file's URL
 */
const QuotePdfGenerator = async (quoteData) => uploadPdfBlob(await buildQuotePdfBlob(quoteData));

export default QuotePdfGenerator;