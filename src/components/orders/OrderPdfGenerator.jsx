import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import { base44 } from "@/api/base44Client";
import { format } from "@/lib/safe-date-fns";
import { bedConfigFieldLines } from "@/lib/bedConfig";

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

const OrderPdfGenerator = async (orderData) => {
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

  const items = Array.isArray(orderData.items) ? orderData.items : [];
  const rows = items.map((item, idx) => {
    const addonsTotal = (item?.selected_addons || []).reduce(
      (sum, addon) => sum + normalizeNumber(addon?.price),
      0,
    );
    const totalUnitPrice = normalizeNumber(item?.unit_price) + addonsTotal;
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
    return {
      idx: idx + 1,
      name: esc(item?.name),
      sku: esc(item?.sku),
      unitPrice: money(totalUnitPrice),
      qty: safe(item?.quantity ?? 1),
      qtyNum: normalizeNumber(item?.quantity ?? 1),
      lineTotal: money(item?.total),
      extraInfoText: extraInfo.length ? esc(extraInfo.join(" | ")) : "",
    };
  });

  const subtotal = normalizeNumber(orderData.subtotal);
  const discount = normalizeNumber(orderData.discount_total);
  const vat = normalizeNumber(orderData.vat_amount);
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
      return `
        <tr>
          <td class="center">${i + 1}</td>
          <td class="center">${date}</td>
          <td>${method}</td>
          <td class="muted">${ref}</td>
          <td class="center">${money(p?.amount)}</td>
        </tr>`;
    })
    .join("");

  const htmlContent = `
  <div dir="rtl" style="font-family: Heebo, Assistant, Arial, sans-serif; background:#F6F8FC; padding:18px;">
    <style>
      @page { size: A4; margin: 0; }
      * { box-sizing: border-box; }
      .page { width: 794px; min-height: 1123px; margin: 0 auto; background:#fff; overflow:hidden; box-shadow: 0 10px 34px rgba(16,24,40,.12); }
      .topbar { padding: 18px 22px; background:#0B0B0B; color:#F3F4F6; display:flex; align-items:center; justify-content:space-between; gap:16px; border-bottom:1px solid #1F2933; }
      .brand { display:flex; flex-direction:column; gap:2px; }
      .brand h1 { margin:0; font-size:18px; font-weight:900; letter-spacing:.2px; }
      .brand .sub { margin:0; font-size:11px; opacity:.82; font-weight:700; }
      .logoWrap { display:flex; align-items:center; justify-content:center; flex:1; }
      .logo { height:46px; width:auto; background:transparent; padding:0; filter:none; }
      .content { padding:18px 22px 14px; }
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
      .footer { padding:10px 22px 14px; color:#667085; font-size:10px; font-weight:900; text-align:center; }
      .footer .row { margin:2px 0; }
    </style>

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
              ${
                orderData.customer_phone
                  ? `<span class="muted">${esc(orderData.customer_phone)}</span>`
                  : ""
              }
            </div>
            <div class="kv">
              <div class="k">שם</div><div class="v">${esc(orderData.customer_name)}</div>
              ${
                orderData.customer_email
                  ? `<div class="k">אימייל</div><div class="v">${esc(orderData.customer_email)}</div>`
                  : ""
              }
              <div class="k">כתובת</div><div class="v">${esc(customerAddress) || "—"}</div>
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
              <th class="center" style="width:90px;">מחיר יחידה</th>
              <th class="center" style="width:70px;">כמות</th>
              <th class="center" style="width:90px;">סה״כ</th>
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
  </div>
  `;

  const tempDiv = document.createElement("div");
  tempDiv.innerHTML = htmlContent;
  tempDiv.style.position = "fixed";
  tempDiv.style.left = "-10000px";
  tempDiv.style.top = "0";
  tempDiv.style.width = "794px";
  tempDiv.style.zIndex = "-1";
  document.body.appendChild(tempDiv);

  try {
    const pageEl = tempDiv.querySelector("#order-page");
    if (!pageEl) throw new Error("PDF root element not found");

    // Cap at 2× so the html2canvas pass is lighter and doesn't freeze the modal.
    const scale = 2;
    const canvas = await html2canvas(pageEl, {
      scale,
      useCORS: true,
      allowTaint: false,
      backgroundColor: "#ffffff",
      logging: false,
      windowWidth: 794,
    });

    const pdf = new jsPDF("p", "mm", "a4");
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = pdf.internal.pageSize.getHeight();
    const pxPerMm = canvas.width / pdfWidth;
    const pageHeightPx = Math.floor(pdfHeight * pxPerMm);

    const pageCanvas = document.createElement("canvas");
    pageCanvas.width = canvas.width;
    const ctx = pageCanvas.getContext("2d");

    // Back a page break up to a BLANK row so slicing never cuts through a line
    // of text / the footer (same fix as the quote PDF).
    let fullData = null;
    try {
      fullData = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    } catch { fullData = null; }
    const isBlankRow = (ry) => {
      if (!fullData) return false;
      const base = ry * canvas.width * 4;
      for (let x = 0; x < canvas.width; x++) {
        const i = base + x * 4;
        if (fullData[i] < 250 || fullData[i + 1] < 250 || fullData[i + 2] < 250) return false;
      }
      return true;
    };
    const cleanBreak = (targetY) => {
      const limit = Math.max(targetY - 220, 0);
      for (let ry = Math.min(targetY, canvas.height - 1); ry >= limit; ry--) {
        if (isBlankRow(ry)) return ry + 1;
      }
      return targetY;
    };

    let y = 0;
    let pageIndex = 0;
    while (y < canvas.height) {
      if (canvas.height - y < 8) break;
      let breakY = y + pageHeightPx;
      breakY = breakY >= canvas.height ? canvas.height : cleanBreak(breakY);
      const heightToRender = breakY - y;
      pageCanvas.height = heightToRender;
      ctx.clearRect(0, 0, pageCanvas.width, pageCanvas.height);
      ctx.drawImage(canvas, 0, y, canvas.width, heightToRender, 0, 0, canvas.width, heightToRender);
      const sliceHeightMm = heightToRender / pxPerMm;
      const imgData = pageCanvas.toDataURL("image/png", 1.0);
      if (pageIndex > 0) pdf.addPage();
      pdf.addImage(imgData, "PNG", 0, 0, pdfWidth, sliceHeightMm, undefined, "FAST");
      y = breakY;
      pageIndex += 1;
    }

    const pdfBlob = pdf.output("blob");
    const file = new File([pdfBlob], `order-${safe(orderData.order_number) || orderData.id}.pdf`, {
      type: "application/pdf",
    });
    const uploadRes = await base44.integrations.Core.UploadFile({ file });
    return uploadRes.file_url;
  } finally {
    document.body.removeChild(tempDiv);
  }
};

export default OrderPdfGenerator;
