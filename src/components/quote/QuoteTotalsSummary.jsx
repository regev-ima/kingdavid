import React from 'react';
import { summaryRows } from '@/lib/quoteTotals';

// Shared order/quote totals summary — used identically by NewQuote / NewOrder /
// EditQuote so the breakdown is the same everywhere. Order (per owner request):
//   סכום לפני מע״מ → מע״מ 18% → סה״כ כולל מע״מ → הנחה כולל מע״מ → סכום לתשלום
// i.e. the LIST price (before discount), then the discount as a visible
// subtraction down to the amount actually due. Two decimals (agorot) so the
// lines add up. The arithmetic itself lives in lib/quoteTotals so this panel
// and the stored quote/order total are the same calculation, not two.
const money = (n) => `₪${(Number(n) || 0).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function Row({ label, value, className = '', strong = false }) {
  return (
    <div className={`flex justify-between text-sm ${className}`}>
      <span className={strong ? 'font-semibold text-foreground' : 'text-muted-foreground'}>{label}</span>
      <span className={strong ? 'font-bold' : 'font-medium'}>{value}</span>
    </div>
  );
}

export default function QuoteTotalsSummary({ items = [], extras = [], total }) {
  const { itemsGrossPreVat, grossVat, grossInclVat, discInclVat, toPay } = summaryRows(items, extras, total);

  return (
    <div className="mt-6 border border-border rounded-xl overflow-hidden">
      <div className="p-4 space-y-3 bg-muted/40">
        <Row label="סכום לפני מע״מ" value={money(itemsGrossPreVat)} />
        <Row label="מע״מ (18%)" value={money(grossVat)} />
        <Row label="סה״כ כולל מע״מ" value={money(grossInclVat)} strong />
        {discInclVat > 0 ? (
          <Row label="הנחה כולל מע״מ" value={`-${money(discInclVat)}`} className="text-red-600" />
        ) : null}
      </div>
      <div className="flex justify-between items-center px-4 py-3.5 bg-primary/5 border-t border-primary/10">
        <span className="text-base font-bold text-foreground">סכום לתשלום</span>
        <span className="text-xl font-bold text-primary">{money(toPay)}</span>
      </div>
    </div>
  );
}
