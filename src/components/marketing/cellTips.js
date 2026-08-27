import { formatCurrency } from '@/utils/currency';
import { formatMins } from './PanelBits';

// The per-cell hover explanations for the channels/campaigns tables: every
// number gets the story behind it — the exact counts, its share of the total,
// and the previous-period comparison. Pure content builders, no JSX.

const n = (v) => Number(v || 0).toLocaleString();
const pctOf = (part, whole) => (whole > 0 ? ((part / whole) * 100).toFixed(1) : '0');

// row: an enriched channel/campaign row from marketingMath.
// col: which cell. totals: the panel totals (for shares/averages).
// rowLabel: "פייסבוק" / the campaign name.
export function buildCellTip({ row, col, totals, rowLabel }) {
  const prev = row.prev;
  switch (col) {
    case 'name': {
      const lines = [
        `${n(row.leads)} לידים · ${n(row.won)} עסקאות · ${formatCurrency(row.revenue)} הכנסות בטווח.`,
      ];
      if (row.costOnly) lines.push('הוזנה עלות אבל לא נכנס אף ליד בטווח.');
      return { title: rowLabel, lines };
    }

    case 'leads': {
      const lines = [`${n(row.leads)} לידים נכנסו מ${rowLabel} בטווח.`];
      if (totals?.leads > 0) lines.push(`${pctOf(row.leads, totals.leads)}% מתוך ${n(totals.leads)} הלידים בתקופה.`);
      if (prev) {
        lines.push(prev.leads > 0
          ? `תקופה קודמת: ${n(prev.leads)} לידים${row.leadsDelta != null ? ` — שינוי של ${Math.round(row.leadsDelta * 100)}%` : ''}.`
          : 'בתקופה הקודמת לא נכנסו לידים.');
      }
      return { title: `לידים — ${rowLabel}`, lines };
    }

    case 'conversion': {
      const lines = [`${n(row.won)} מתוך ${n(row.leads)} לידים סגרו עסקה — ${Number(row.conversion || 0).toFixed(1)}%.`];
      if (totals?.conversion != null) lines.push(`ההמרה הממוצעת בתקופה: ${Number(totals.conversion).toFixed(1)}%.`);
      if (row.open > 0) lines.push(`${n(row.open)} לידים עדיין בטיפול ויכולים עוד להיסגר.`);
      if (prev?.conversion > 0) lines.push(`תקופה קודמת: ${prev.conversion.toFixed(1)}%.`);
      return { title: `המרה — ${rowLabel}`, lines };
    }

    case 'contacted': {
      const waiting = Math.max(0, row.leads - row.contacted);
      const lines = [`${n(row.contacted)} מתוך ${n(row.leads)} לידים קיבלו שיחה ראשונה — ${Number(row.contactedRate || 0).toFixed(0)}%.`];
      if (waiting > 0) lines.push(`${n(waiting)} לידים עדיין לא נענו.`);
      return { title: `טופלו — ${rowLabel}`, lines };
    }

    case 'quoted':
      return {
        title: `הצעות מחיר — ${rowLabel}`,
        lines: [
          `${n(row.quoted)} מתוך ${n(row.leads)} לידים קיבלו הצעת מחיר — ${Number(row.quoteRate || 0).toFixed(0)}%.`,
          'נספרות רק הצעות שהופקו מהמערכת; עסקאות רבות נסגרות בלי הצעה רשומה.',
        ],
      };

    case 'won': {
      const lines = [`${n(row.won)} עסקאות נסגרו מתוך ${n(row.leads)} לידים.`];
      if (row.won > 0 && row.revenue > 0) lines.push(`ממוצע לעסקה: ${formatCurrency(row.revenue / row.won)}.`);
      return { title: `נסגרו — ${rowLabel}`, lines };
    }

    case 'medianMins': {
      if (row.medianMins == null) {
        return { title: `זמן תגובה — ${rowLabel}`, lines: ['אין מספיק נתוני שיחה ראשונה לחישוב.'] };
      }
      return {
        title: `זמן תגובה — ${rowLabel}`,
        lines: [
          `ליד מ${rowLabel} מחכה חציונית ${formatMins(row.medianMins)} לשיחה ראשונה.`,
          'חצי מהלידים נענו מהר יותר, חצי לאט יותר. ליד שנענה מהר נסגר בסיכוי גבוה יותר.',
        ],
      };
    }

    case 'revenue': {
      const lines = [`${formatCurrency(row.revenue)} מ-${n(row.orders)} הזמנות של לידי ${rowLabel} בטווח.`];
      if (row.orders > 0) lines.push(`ממוצע להזמנה: ${formatCurrency(row.revenue / row.orders)}.`);
      if (row.leads > 0) lines.push(`הכנסה ממוצעת לליד: ${formatCurrency(row.revenue / row.leads)}.`);
      lines.push('כולל הזמנות שבוצעו אחרי סוף הטווח; לא כולל מבוטלות.');
      return { title: `הכנסות — ${rowLabel}`, lines };
    }

    case 'spend':
      return {
        title: `עלות — ${rowLabel}`,
        lines: row.spend > 0
          ? [`${formatCurrency(row.spend)} הוזנו בטבלת עלויות השיווק עבור ${rowLabel} בטווח.`]
          : ['לא הוזנו עלויות שיווק בטווח. ברגע שיוזנו, יחושבו גם CPL, CAC ו-ROAS.'],
      };

    case 'cpl':
      return {
        title: `עלות לליד — ${rowLabel}`,
        lines: row.cpl != null
          ? [`${formatCurrency(row.spend)} עלות ÷ ${n(row.leads)} לידים = ${formatCurrency(row.cpl)} לליד.`]
          : ['דורש הזנת עלויות שיווק לתקופה.'],
      };

    case 'cac':
      return {
        title: `עלות לעסקה — ${rowLabel}`,
        lines: row.cac != null
          ? [
            `${formatCurrency(row.spend)} עלות ÷ ${n(row.won)} עסקאות = ${formatCurrency(row.cac)} לעסקה.`,
            'המדד האמיתי להשוואה: לידים זולים שלא קונים הם לא זולים.',
          ]
          : row.spend > 0
            ? ['הוזנה עלות אבל לא נסגרה אף עסקה — אי אפשר לחשב עלות לעסקה.']
            : ['דורש הזנת עלויות שיווק לתקופה.'],
      };

    case 'roas': {
      if (row.roas == null) {
        return { title: `ROAS — ${rowLabel}`, lines: ['דורש הזנת עלויות שיווק לתקופה.'] };
      }
      const verdict = row.roas >= 2
        ? 'החזר טוב — ההשקעה מכפילה את עצמה ומעלה.'
        : row.roas >= 1
          ? 'ההשקעה מחזירה את עצמה, בלי הרבה מעבר.'
          : 'הפסד: כל שקל מחזיר פחות משקל.';
      return {
        title: `ROAS — ${rowLabel}`,
        lines: [
          `${formatCurrency(row.revenue)} הכנסות ÷ ${formatCurrency(row.spend)} עלות = ${row.roas.toFixed(2)}x.`,
          verdict,
        ],
      };
    }

    default:
      return null;
  }
}
