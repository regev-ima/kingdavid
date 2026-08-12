import { base44 } from "@/api/base44Client";
import { format } from "@/lib/safe-date-fns";
import { bedConfigFieldLines } from "@/lib/bedConfig";
import { DOCUMENT_TERMS_LABELS, orderTermsFields, resolveDocumentTerms } from "@/constants/documentTerms";
import { SOURCE_LABELS } from "@/constants/leadOptions";
import { formatInstallments } from "@/lib/installments";
import { fetchDocumentTermsSetting } from "@/lib/documentTermsSettings";
import { renderPagesToPdf, uploadPdfBlob, withMountedPages } from "@/lib/pdfPages";
import { lineDisplayInclVat, summaryRows } from "@/lib/quoteTotals";

const PAYMENT_METHOD_LABELS = {
  cash: "מזומן",
  credit_card: "כרטיס אשראי",
  bank_transfer: "העברה בנקאית",
  check: "צ׳ק",
  bit: "ביט",
  paybox: "פייבוקס",
  other: "אחר",
};

const PAYMENT_STATUS_LABELS = {
  paid: { label: "שולם במלואו", bg: "#DCFCE7", color: "#166534" },
  deposit_paid: { label: "מקדמה שולמה", bg: "#FEF3C7", color: "#92400E" },
  unpaid: { label: "לא שולם", bg: "#FEE2E2", color: "#991B1B" },
  refunded: { label: "הוחזר", bg: "#E0E7FF", color: "#3730A3" },
};

/**
 * Render the order to a PDF and hand back the bytes.
 *
 * Split out from the default export because "הורד PDF" wants the file itself,
 * not a link to it: uploading first and then opening the URL cost a round trip
 * and lost the file to the popup blocker (see lib/downloadBlob.js).
 *
 * @returns {Promise<{blob: Blob, fileName: string}>}
 */
export const buildOrderPdfBlob = async (orderData) => {
  const logoUrl =
    "https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/6956450f0d239229ec5ea53f/0de0b7ac4_image.png";

  const safe = (v) => (v === null || v === undefined ? "" : String(v));
  const esc = (v) =>
    safe(v)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  // Short free text (terms, warranty) keeps its line breaks; the general terms
  // block is a bullet list. Both mirror the quote PDF — one document, two
  // stages of the same sale, so they have to read the same.
  const escMultiline = (v) => esc(v).replace(/\r?\n/g, "<br/>");
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

  const normalizeNumber = (n) => {
    const x = Number(n);
    return Number.isFinite(x) ? x : 0;
  };
  // Two decimals (agorot) so line amounts sum exactly to the printed total.
  const money = (n) => `₪${normalizeNumber(n).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const createdDate = orderData?.created_date
    ? format(new Date(orderData.created_date), "dd/MM/yyyy")
    : "";

  const customerAddress = `${safe(orderData.delivery_address)}${
    orderData.delivery_city ? `, ${safe(orderData.delivery_city)}` : ""
  }`.trim();

  // Self pickup: there is no delivery address to print, and the order has to
  // say so in writing — the customer's copy is what the warehouse goes by when
  // he shows up to collect.
  const selfPickup = Boolean(orderData.is_self_pickup);

  // Floor and apartment ride with the address — they're what the delivery crew
  // needs, and floor 0 is a real answer (קומת קרקע), not a missing one.
  const hasFloor = orderData.floor !== null && orderData.floor !== undefined && String(orderData.floor) !== "";
  const floorApartment = [
    hasFloor ? `קומה ${safe(orderData.floor)}` : "",
    orderData.apartment_number ? `דירה ${safe(orderData.apartment_number)}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  // "מקור הגעה" — where the sale came from. The order stores the bucket
  // (the lead's source, stamped at creation); the campaign/UTM detail behind it
  // stays on the lead and off the customer's copy. Same labels as the order
  // screen and the orders list, so one order reads the same everywhere.
  const sourceLabel = SOURCE_LABELS[orderData.source] || safe(orderData.source);

  // The order stores the rep's email; the printed order should show their name.
  // A failed lookup falls back to the email — the customer's copy naming the
  // rep by address beats leaving "נציג מטפל" blank.
  let repName = safe(orderData.rep1);
  if (orderData.rep1) {
    try {
      const repRows = await base44.entities.User.filter({ email: orderData.rep1 }, null, 1);
      if (repRows?.[0]?.full_name) repName = repRows[0].full_name;
    } catch {
      // keep the email
    }
  }

  // What the customer signs. Resolution order matches the order screen:
  // the order's own stamped copy → the quote it was converted from (orders
  // predating the copy have none of their own) → the company defaults →
  // the text in code. Every lookup is best-effort: the printed order must
  // never fail over a missing table or a deleted quote.
  let termsFallback = (await fetchDocumentTermsSetting())?.value || null;
  if (!orderData.terms && !orderData.legal_notes && orderData.quote_id) {
    try {
      const quoteRows = await base44.entities.Quote.filter({ id: orderData.quote_id }, null, 1);
      if (quoteRows?.[0]) termsFallback = resolveDocumentTerms(quoteRows[0], termsFallback);
    } catch {
      // keep the company defaults
    }
  }
  const printedTerms = resolveDocumentTerms(orderTermsFields(orderData), termsFallback);

  const items = Array.isArray(orderData.items) ? orderData.items : [];
  // Delivery/assembly extras (הובלה והרכבה) live next to items on the order and
  // their cost is already inside subtotal/total — without rows of their own the
  // printed lines don't add up to the totals box and the customer never sees
  // the delivery fee. Same merge the quote PDF does.
  const extras = Array.isArray(orderData.extras) ? orderData.extras : [];
  const itemRows = items.map((item, idx) => {
    // Add-ons fold into the unit price inside lineDisplayInclVat; nothing here
    // needs their sum any more.
    const hasAddons = (item?.selected_addons || []).length > 0;
    const hasSize = item?.length_cm && item?.width_cm;
    const extraInfo = [];
    if (hasSize) {
      extraInfo.push(
        `מידה: ${item.length_cm}×${item.width_cm}${
          item.height_cm ? `×${item.height_cm}` : ""
        } ס"מ`,
      );
    }
    if (hasAddons) {
      const addonsText = (item.selected_addons || [])
        .map((a) => `${a.name} (+₪${normalizeNumber(a.price).toLocaleString()})`)
        .join(", ");
      extraInfo.push(`תוספות: ${addonsText}`);
    }
    // Bed text-question answers (fabric catalog etc.) — the generic path (esc()
    // is applied to the whole extraInfo join below). Falls back to legacy
    // fabric_* columns for orders saved before the feature.
    const fieldLines = bedConfigFieldLines(item);
    if (fieldLines.length) {
      fieldLines.forEach((ln) => extraInfo.push(ln));
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
    // Every printed figure VAT-inclusive, like the screen — see
    // lineDisplayInclVat. The stored numbers are pre-VAT and printing them raw
    // is what made the same bed read ₪6,390 here and ₪7,540.20 on the screen.
    const line = lineDisplayInclVat(item);
    return {
      idx: idx + 1,
      name: esc(item?.name),
      sku: esc(item?.sku),
      unitPrice: money(line.unitIncl),
      qty: safe(item?.quantity ?? 1),
      qtyNum: normalizeNumber(item?.quantity ?? 1),
      discount: line.discountIncl > 0 ? `-${money(line.discountIncl)}` : "—",
      discountPercent: line.discountIncl > 0 && line.discountPercent
        ? `${normalizeNumber(line.discountPercent).toLocaleString('he-IL', { maximumFractionDigits: 2 })}%`
        : "",
      lineTotal: money(line.totalIncl),
      extraInfoText: extraInfo.length ? esc(extraInfo.join(" | ")) : "",
    };
  });
  const rows = [
    ...itemRows,
    // Extras are stored VAT-INCLUSIVE (see lib/quoteTotals), so they are the one
    // thing on this table that must NOT be multiplied — doing so would bill the
    // delivery's VAT twice.
    ...extras.map((extra, j) => ({
      idx: items.length + j + 1,
      name: esc(extra?.name),
      sku: "תוספת",
      unitPrice: money(extra?.cost),
      qty: "1",
      qtyNum: 1,
      discount: "—",
      discountPercent: "",
      lineTotal: money(extra?.cost),
      extraInfoText: "",
    })),
  ];

  // The same breakdown the order screen shows, from the same function — so the
  // printed document and the screen can't state two different discounts. The
  // stored subtotal/discount/vat columns are deliberately not printed: subtotal
  // is already NET of the discount, so printing it above a discount line asked
  // the customer to subtract something that had been subtracted already.
  const breakdown = summaryRows(items, extras, orderData.total);
  const total = normalizeNumber(orderData.total);

  const payments = Array.isArray(orderData.payments) ? orderData.payments : [];
  const totalPaid = payments.reduce(
    (sum, p) => sum + normalizeNumber(p?.amount),
    0,
  );
  const remaining = Math.max(0, total - totalPaid);

  const statusKey = orderData.payment_status || "unpaid";
  const statusMeta =
    PAYMENT_STATUS_LABELS[statusKey] || PAYMENT_STATUS_LABELS.unpaid;

  const paymentRowsHtml = payments
    .map((p, i) => {
      const method =
        PAYMENT_METHOD_LABELS[p?.method] || esc(p?.method || "—");
      const date = p?.date ? format(new Date(p.date), "dd/MM/yyyy") : "—";
      const refParts = [];
      if (p?.hyp_transaction_id) refParts.push(`מס׳ עסקה ${esc(p.hyp_transaction_id)}`);
      if (p?.hyp_acode) refParts.push(`אישור ${esc(p.hyp_acode)}`);
      if (p?.hyp_brand || p?.hyp_l4digit) {
        refParts.push(
          `${esc(p.hyp_brand || "")}${p?.hyp_l4digit ? ` **** ${esc(p.hyp_l4digit)}` : ""}`.trim(),
        );
      }
      if (!refParts.length && p?.notes) refParts.push(esc(p.notes));
      const ref = refParts.length ? refParts.join(" · ") : "—";
      // How many instalments the charge was split into. Hyp reports it per
      // transaction (hyp-verify / hyp-notify store it), so it's a column on the
      // payment rather than one number for the whole order — two cards can be
      // split differently. When Hyp didn't report a count — or the payment
      // wasn't a Hyp charge at all — the row is still one payment, so the
      // column prints 1 rather than a dash.
      const installments = normalizeNumber(p?.hyp_payments_count);
      // The count alone ("12") is the number nobody asks for. The split under
      // it — "221 ועוד 11 תשלומים של 219" — is what the customer is holding
      // the page to read. Derived from the amount and the count; see
      // lib/installments for why that derivation is sound here.
      const breakdown = esc(formatInstallments(p?.amount, installments));
      return `
        <tr>
          <td class="center">${i + 1}</td>
          <td class="center">${date}</td>
          <td>${method}</td>
          <td class="muted">${ref}</td>
          <td class="center">
            ${installments > 0 ? installments : "1"}
            ${breakdown ? `<div class="muted" style="font-size:9px; line-height:1.35; margin-top:2px; white-space:nowrap;">${breakdown}</div>` : ""}
          </td>
          <td class="center">${money(p?.amount)}</td>
        </tr>`;
    })
    .join("");

  const htmlContent = `
  <div dir="rtl" style="font-family: Heebo, Assistant, Arial, sans-serif; background:#F6F8FC; padding:18px;">
    <style>
      @page { size: A4; margin: 0; }
      * { box-sizing: border-box; }
      /* One A4 sheet. Flex column so the footer sits on the bottom edge even on
         the terms sheet, which doesn't fill its page. */
      .page { width: 794px; min-height: 1123px; margin: 0 auto; background:#fff; overflow:hidden; box-shadow: 0 10px 34px rgba(16,24,40,.12); display:flex; flex-direction:column; }
      .page + .page { margin-top: 18px; }
      .topbar { padding: 18px 22px; background:#0B0B0B; color:#F3F4F6; display:flex; align-items:center; justify-content:space-between; gap:16px; border-bottom:1px solid #1F2933; }
      .brand { display:flex; flex-direction:column; gap:2px; }
      .brand h1 { margin:0; font-size:18px; font-weight:900; letter-spacing:.2px; }
      .brand .sub { margin:0; font-size:11px; opacity:.82; font-weight:700; }
      .logoWrap { display:flex; align-items:center; justify-content:center; flex:1; }
      .logo { height:46px; width:auto; background:transparent; padding:0; filter:none; }
      .content { padding:18px 22px 14px; flex:1; }
      .titleRow { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:12px; }
      .title { font-size:16px; font-weight:900; margin:0; color:#0B1220; }
      .titleWithNumber { display:flex; align-items:center; gap:12px; }
      .orderNum { font-size:14px; font-weight:700; color:#667085; }
      .meta { display:flex; gap:12px; flex-wrap:wrap; font-size:11px; color:#667085; font-weight:700; }
      .statusPill { font-size:11px; font-weight:900; padding:4px 10px; border-radius:999px; background:${statusMeta.bg}; color:${statusMeta.color}; }
      .grid { display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-bottom:12px; }
      .card { border:1px solid #E8ECF4; background:#fff; border-radius:14px; padding:12px; }
      .cardTitle { font-size:11px; font-weight:900; color:#111827; margin:0 0 8px 0; display:flex; align-items:center; justify-content:space-between; }
      .kv { display:grid; grid-template-columns:84px 1fr; row-gap:6px; column-gap:10px; font-size:11px; color:#0B1220; }
      .k { color:#667085; font-weight:900; }
      .v { font-weight:900; }
      .divider { height:1px; background:#EEF2F7; margin:12px 0; }
      table { width:100%; border-collapse:separate; border-spacing:0; overflow:hidden; border:1px solid #E8ECF4; border-radius:14px; }
      thead th { background:#111827; color:#fff; font-size:11px; font-weight:900; padding:10px; text-align:right; border-left:1px solid rgba(255,255,255,.08); white-space:nowrap; }
      thead th:last-child { border-left:none; }
      tbody td { font-size:11px; padding:10px; border-top:1px solid #EEF2F7; color:#0B1220; font-weight:900; }
      tbody tr:nth-child(even) td { background:#FAFBFF; }
      .center { text-align:center; }
      .muted { color:#667085; font-weight:900; }
      .highlight { background:#FEF08A !important; }
      .summaryRow { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-top:12px; align-items:stretch; }
      .totals { border:1px solid #E8ECF4; border-radius:14px; padding:12px; background:linear-gradient(180deg,#FFFFFF 0%,#FAFBFF 100%); }
      .totals .line { display:flex; justify-content:space-between; font-size:11px; padding:6px 0; color:#0B1220; font-weight:900; }
      .totals .line .label { color:#667085; font-weight:900; }
      .totals .line.total { border-top:1px dashed #D8DEEA; margin-top:6px; padding-top:10px; font-size:12px; }
      .discount { color:#B42318; }
      .th-sub { font-size:8px; font-weight:400; opacity:.75; margin-top:1px; }
      .paymentBlock { margin-top:12px; border:1px solid #E8ECF4; border-radius:14px; background:#fff; overflow:hidden; }
      .paymentHeader { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:12px 14px; background:#F8FAFC; border-bottom:1px solid #E8ECF4; }
      .paymentHeader .ttl { font-size:12px; font-weight:900; color:#0B1220; }
      .paymentSummary { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; padding:12px 14px; border-bottom:1px solid #EEF2F7; }
      .paymentSummary .cell { display:flex; flex-direction:column; gap:2px; }
      .paymentSummary .cell .k { color:#667085; font-size:10px; font-weight:900; }
      .paymentSummary .cell .v { font-size:14px; font-weight:900; }
      .paymentSummary .cell.remaining .v { color:${remaining > 0 ? "#B42318" : "#166534"}; }
      .paymentSummary .cell.paid .v { color:#166534; }
      .paymentTable { padding:0 14px 14px; }
      .paymentTable table { margin-top:8px; border-radius:10px; }
      .noPayments { padding:14px; font-size:11px; color:#667085; text-align:center; font-weight:900; }
      /* The legal texts get a sheet of their own, so they get readable type
         (11px) instead of the 9px they were squeezed to when everything had to
         fit under the payment block. */
      .terms { margin-top:10px; border:1px solid #E8ECF4; background:#FFFFFF; border-radius:14px; padding:10px 14px; font-size:11px; color:#0B1220; font-weight:400; line-height:1.65; }
      .terms p { margin:0 0 4px 0; font-weight:400; }
      .terms p:last-child { margin:0; }
      .terms-label { font-size:12px; font-weight:900; margin:0 0 8px 0; color:#111827; }
      .terms-item { display:flex; flex-direction:row; align-items:flex-start; gap:8px; margin:0 0 6px 0; font-weight:400; text-align:right; }
      .terms-item:last-child { margin:0; }
      .terms-bullet { flex:0 0 auto; color:#4B5563; line-height:1.65; }
      /* The terms sheet is a column so the signature can be pushed to the foot
         of the page (margin-top:auto) instead of leaving a blank third under
         it. When the terms overflow there's no free space left and the block
         simply follows them. */
      .termsContent { display:flex; flex-direction:column; }
      .termsContent .sig { margin-top:auto; }
      .sig { margin-top:12px; border:1px solid #E8ECF4; border-radius:14px; padding:12px; background:#fff; }
      .sig .label { font-size:11px; font-weight:900; color:#111827; margin:0; }
      .sig .line { margin-top:38px; border-bottom:2px solid #111827; opacity:.18; }
      .sig .hint { margin:8px 0 0; font-size:10px; color:#667085; font-weight:900; text-align:center; }
      .footer { padding:10px 22px 14px; color:#667085; font-size:10px; font-weight:900; text-align:center; }
      .footer .row { margin:2px 0; }
    </style>

    <!-- Sheet 1 — the order itself: who, what, how much, what was paid. -->
    <div class="page" id="order-page">
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
            <h2 class="title">הזמנת לקוח</h2>
            <span class="orderNum">#${esc(orderData.order_number)}</span>
            <span class="statusPill">${statusMeta.label}</span>
          </div>
          <div class="meta">
            <span>תאריך: ${createdDate}</span>
            <span>סניף: ראשון לציון</span>
          </div>
        </div>

        <div class="grid">
          <div class="card">
            <div class="cardTitle">
              <span>פרטי לקוח</span>
            </div>
            <div class="kv">
              <div class="k">שם ושם משפחה</div><div class="v">${esc(orderData.customer_name)}</div>
              ${
                /* The main number used to sit greyed-out in the card header,
                   which read as a caption rather than as one of the customer's
                   details — and left "טלפון נוסף" looking like the only phone
                   on the order. It's a row like every other field now. */
                orderData.customer_phone
                  ? `<div class="k">טלפון</div><div class="v" dir="ltr" style="text-align:right;">${esc(orderData.customer_phone)}</div>`
                  : ""
              }
              ${
                orderData.customer_phone_2
                  ? `<div class="k">טלפון נוסף</div><div class="v" dir="ltr" style="text-align:right;">${esc(orderData.customer_phone_2)}</div>`
                  : ""
              }
              ${
                orderData.customer_id_number
                  ? `<div class="k">ת.ז.</div><div class="v" dir="ltr" style="text-align:right;">${esc(orderData.customer_id_number)}</div>`
                  : ""
              }
              ${
                orderData.customer_email
                  ? `<div class="k">אימייל</div><div class="v">${esc(orderData.customer_email)}</div>`
                  : ""
              }
              ${
                selfPickup
                  ? `<div class="k">אופן אספקה</div><div class="v" style="font-weight:700;">איסוף עצמי - בתיאום</div>
                     <div class="k">מקום האיסוף</div><div class="v">רחוב העמל 6, קרית מלאכי · א׳-ה׳ 9:00-16:00</div>`
                  : `<div class="k">כתובת</div><div class="v">${esc(customerAddress) || "—"}</div>
              ${
                floorApartment
                  ? `<div class="k">קומה / דירה</div><div class="v">${esc(floorApartment)}</div>`
                  : ""
              }`
              }
            </div>
          </div>

          <div class="card">
            <div class="cardTitle">
              <span>פרטי הזמנה</span>
              <span class="muted">#${esc(orderData.order_number)}</span>
            </div>
            <div class="kv">
              <div class="k">מס׳ הזמנה</div><div class="v">${esc(orderData.order_number)}</div>
              <div class="k">תאריך</div><div class="v">${createdDate}</div>
              <div class="k">סטטוס תשלום</div><div class="v">${statusMeta.label}</div>
              ${
                repName
                  ? `<div class="k">נציג מטפל</div><div class="v">${esc(repName)}</div>`
                  : ""
              }
              ${
                sourceLabel
                  ? `<div class="k">מקור הגעה</div><div class="v">${esc(sourceLabel)}</div>`
                  : ""
              }
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
              <th class="center" style="width:96px;">מחיר יחידה<div class="th-sub">כולל מע״מ</div></th>
              <th class="center" style="width:60px;">כמות</th>
              <th class="center" style="width:90px;">הנחה</th>
              <th class="center" style="width:96px;">סה״כ<div class="th-sub">כולל מע״מ</div></th>
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
                    ${
                      r.extraInfoText
                        ? `<div style="font-size:9px; color:#667085; margin-top:2px;">${r.extraInfoText}</div>`
                        : ""
                    }
                  </td>
                  <td class="center muted">${r.sku || "—"}</td>
                  <td class="center">${r.unitPrice}</td>
                  <td class="center${r.qtyNum >= 2 ? " highlight" : ""}">${r.qty}</td>
                  <td class="center${r.discountPercent || r.discount !== "—" ? " discount" : " muted"}">
                    ${r.discount}
                    ${r.discountPercent ? `<div class="th-sub">${r.discountPercent}</div>` : ""}
                  </td>
                  <td class="center">${r.lineTotal}</td>
                </tr>`,
                    )
                    .join("")
                : `
                <tr>
                  <td class="center">1</td>
                  <td>—</td>
                  <td class="center muted">—</td>
                  <td class="center">—</td>
                  <td class="center">—</td>
                  <td class="center">—</td>
                  <td class="center">—</td>
                </tr>`
            }
          </tbody>
        </table>

        ${
          Array.isArray(orderData.payment_terms_selection) && orderData.payment_terms_selection.length
            ? `
        <div class="card" style="margin-bottom:10px;">
          <div class="cardTitle"><span>אמצעי תשלום</span></div>
          <div style="font-size:12px; color:#0B1220; line-height:1.6; font-weight:500;">
            ${orderData.payment_terms_selection.map(esc).join(' · ')}
          </div>
        </div>
        `
            : ""
        }

        ${
          orderData.special_requests
            ? `
        <div class="card" style="margin-bottom:10px;">
          <div class="cardTitle"><span>בקשות מיוחדות</span></div>
          <div style="font-size:12px; color:#0B1220; line-height:1.6; font-weight:500;">
            ${esc(orderData.special_requests)}
          </div>
        </div>
        `
            : ""
        }

        <div class="summaryRow">
          <div class="card">
            <div class="cardTitle"><span>הערות</span></div>
            <div style="font-size:11px; color:#0B1220; line-height:1.6; font-weight:400; min-height:60px;">
              ${esc(orderData.notes_sales) || "—"}
            </div>
          </div>

          <div class="totals">
            <div class="line"><span class="label">סכום לפני מע״מ</span><span>${money(breakdown.itemsGrossPreVat)}</span></div>
            <div class="line"><span class="label">מע״מ (18%)</span><span>${money(breakdown.grossVat)}</span></div>
            <div class="line"><span class="label">סה״כ כולל מע״מ</span><span>${money(breakdown.grossInclVat)}</span></div>
            ${
              breakdown.discInclVat > 0
                ? `<div class="line"><span class="label discount">הנחה כולל מע״מ</span><span class="discount">-${money(breakdown.discInclVat)}</span></div>`
                : ""
            }
            <div class="line total"><span class="label">סכום לתשלום</span><span>${money(breakdown.toPay)}</span></div>
          </div>
        </div>

        <div class="paymentBlock">
          <div class="paymentHeader">
            <span class="ttl">פרטי תשלום</span>
            <span class="statusPill">${statusMeta.label}</span>
          </div>
          <div class="paymentSummary">
            <div class="cell">
              <span class="k">סה״כ הזמנה</span>
              <span class="v">${money(total)}</span>
            </div>
            <div class="cell paid">
              <span class="k">שולם</span>
              <span class="v">${money(totalPaid)}</span>
            </div>
            <div class="cell remaining">
              <span class="k">${remaining > 0 ? "יתרה לתשלום" : "שולם במלואו"}</span>
              <span class="v">${remaining > 0 ? money(remaining) : "✓"}</span>
            </div>
          </div>
          ${
            payments.length
              ? `
            <div class="paymentTable">
              <table>
                <thead>
                  <tr>
                    <th class="center" style="width:42px;">#</th>
                    <th class="center" style="width:90px;">תאריך</th>
                    <th>אמצעי תשלום</th>
                    <th>אסמכתא</th>
                    <th class="center" style="width:132px;">תשלומים</th>
                    <th class="center" style="width:90px;">סכום</th>
                  </tr>
                </thead>
                <tbody>${paymentRowsHtml}</tbody>
              </table>
            </div>`
              : `<div class="noPayments">לא נרשמו תשלומים על ההזמנה</div>`
          }
        </div>
      </div>

      <div class="footer">
        <div class="row">משרדים וחנות המפעל – רח׳ בן צבי 23 ראשל״צ</div>
        <div class="row">כתובת מפעל החברה: רחוב העמל 6 קרית מלאכי</div>
        <div class="row">טל: 1700-700-464, פקס: 03-9622319</div>
      </div>
    </div>

    <!-- Sheet 2 — the legal texts and the signature. They used to trail the
         payment block on sheet 1 and get chopped mid-clause wherever the A4
         line happened to fall; on a sheet of their own they read in full, and
         the customer signs directly under what he's signing for. -->
    <div class="page" id="order-page-terms">
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

      <div class="content termsContent">
        <div class="titleRow">
          <div class="titleWithNumber">
            <h2 class="title">תנאי ההזמנה</h2>
            <span class="orderNum">#${esc(orderData.order_number)}</span>
          </div>
          <div class="meta">
            ${orderData.customer_name ? `<span>${esc(orderData.customer_name)}</span>` : ""}
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

        <!-- The terms end with "הלקוח מאשר בחתימתו" — the printed order is the
             only place that signature happens, so it needs a line to sign on. -->
        <div class="sig">
          <p class="label">חתימת לקוח</p>
          <div class="line"></div>
          <p class="hint">חתימה</p>
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

  // Sheet 1 (order) then sheet 2 (terms), each rendered onto its own A4 page.
  const pdf = await withMountedPages(htmlContent, (pages) => renderPagesToPdf(pages));

  return {
    blob: pdf.output("blob"),
    fileName: `order-${safe(orderData.order_number) || orderData.id}.pdf`,
  };
};

/**
 * The same PDF, uploaded — for the paths that need a URL to hand to someone
 * else (WhatsApp, email).
 * @returns {Promise<string>} the uploaded file's URL
 */
const OrderPdfGenerator = async (orderData) => uploadPdfBlob(await buildOrderPdfBlob(orderData));

export default OrderPdfGenerator;
