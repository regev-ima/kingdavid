import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import { base44 } from "@/api/base44Client";
import { format } from "date-fns";

/**
 * KING DAVID - Premium PDF Quote Generator
 */
const QuotePdfGenerator = async (quoteData) => {
  const logoUrl = "https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/6956450f0d239229ec5ea53f/0de0b7ac4_image.png";

  const safe = (v) => (v === null || v === undefined ? "" : String(v));

  const normalizeNumber = (n) => {
    const x = Number(n);
    return Number.isFinite(x) ? x : 0;
  };

  const money = (n) => {
    const num = normalizeNumber(n);
    return `₪${num.toLocaleString("he-IL")}`;
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

      .page {
        width: 794px;
        min-height: 1123px;
        margin: 0 auto;
        background: #ffffff;
        overflow: hidden;
        box-shadow: 0 10px 34px rgba(16,24,40,.12);
      }

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

      .content { padding: 18px 22px 14px; }

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
        font-size: 11px;
        font-weight: 900;
        padding: 10px 10px;
        text-align: right;
        border-left: 1px solid rgba(255,255,255,.08);
        white-space: nowrap;
      }
      thead th:last-child { border-left: none; }
      tbody td {
        font-size: 11px;
        padding: 10px 10px;
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
        margin-top: 10px;
        border: 1px solid #E8ECF4;
        background: #FFFFFF;
        border-radius: 14px;
        padding: 12px;
        font-size: 11px;
        color:#0B1220;
        font-weight: 900;
      }
      .notes p { margin: 0 0 6px 0; }
      .notes p:last-child { margin:0; }

      .footer {
        padding: 10px 22px 14px;
        color:#667085;
        font-size: 10px;
        font-weight: 900;
        text-align:center;
      }
      .footer .row { margin: 2px 0; }
    </style>

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
              <div class="k">לכבוד</div><div class="v">${safe(quoteData.customer_name)}</div>
              <div class="k">כתובת</div><div class="v">${safe(customerAddress)}</div>
              ${safe(quoteData.floor) ? `<div class="k">קומה</div><div class="v">${safe(quoteData.floor)}</div>` : ""}
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
          quoteData.terms || quoteData.warranty_terms || quoteData.notes
            ? `
          <div class="notes">
            ${quoteData.notes ? `<p><strong>הערות:</strong> ${safe(quoteData.notes)}</p>` : ""}
            ${quoteData.terms ? `<p>${safe(quoteData.terms)}</p>` : ""}
            ${quoteData.warranty_terms ? `<p>${safe(quoteData.warranty_terms)}</p>` : ""}
          </div>
        `
            : ""
        }
      </div>

      <div class="footer">
        <div class="row">רח׳ בן צבי 23, רמת אליהו, ראשון לציון 75706 | טל׳ 03-9622319 | פקס 03-9628989</div>
        <div class="row">info@kingdavid4u.co.il | www.kingdavid4u.co.il</div>
      </div>
    </div>
  </div>
  `;

  // Mount hidden DOM
  const tempDiv = document.createElement("div");
  tempDiv.innerHTML = htmlContent;
  tempDiv.style.position = "fixed";
  tempDiv.style.left = "-10000px";
  tempDiv.style.top = "0";
  tempDiv.style.width = "794px";
  tempDiv.style.zIndex = "-1";
  document.body.appendChild(tempDiv);

  try {
    const pageEl = tempDiv.querySelector("#quote-page");
    if (!pageEl) throw new Error("PDF root element not found");

    // Render canvas
    const scale = Math.min(3, window.devicePixelRatio ? window.devicePixelRatio * 2 : 2);

    const canvas = await html2canvas(pageEl, {
      scale,
      useCORS: true,
      allowTaint: false,
      backgroundColor: "#ffffff",
      logging: false,
      windowWidth: 794,
    });

    // Build PDF (A4)
    const pdf = new jsPDF("p", "mm", "a4");
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = pdf.internal.pageSize.getHeight();

    // Slice canvas into pages
    const pxPerMm = canvas.width / pdfWidth;
    const pageHeightPx = Math.floor(pdfHeight * pxPerMm);

    const pageCanvas = document.createElement("canvas");
    pageCanvas.width = canvas.width;
    pageCanvas.height = pageHeightPx;
    const ctx = pageCanvas.getContext("2d");

    let y = 0;
    let pageIndex = 0;

    while (y < canvas.height) {
      const remainingHeight = canvas.height - y;
      
      // Skip creating a new page if remaining content is less than 100px (nearly empty)
      if (remainingHeight < 100 && pageIndex > 0) {
        break;
      }

      ctx.clearRect(0, 0, pageCanvas.width, pageCanvas.height);

      const heightToRender = Math.min(pageHeightPx, remainingHeight);
      
      ctx.drawImage(
        canvas,
        0,
        y,
        canvas.width,
        heightToRender,
        0,
        0,
        canvas.width,
        heightToRender
      );

      const sliceHeightMm = Math.min(pdfHeight, heightToRender / pxPerMm);
      const imgData = pageCanvas.toDataURL("image/png", 1.0);

      if (pageIndex > 0) pdf.addPage();
      pdf.addImage(imgData, "PNG", 0, 0, pdfWidth, sliceHeightMm, undefined, "FAST");

      y += pageHeightPx;
      pageIndex += 1;
    }

    // Upload via Base44
    const pdfBlob = pdf.output("blob");
    const file = new File([pdfBlob], `${safe(quoteData.quote_number)}.pdf`, {
      type: "application/pdf",
    });

    const uploadRes = await base44.integrations.Core.UploadFile({ file });
    return uploadRes.file_url;
  } finally {
    document.body.removeChild(tempDiv);
  }
};

export default QuotePdfGenerator;