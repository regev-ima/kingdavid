import React from 'react';

// Shared order/quote totals summary — used identically by NewQuote / NewOrder /
// EditQuote so the breakdown is the same everywhere. Order (per owner request):
//   סכום לפני מע״מ → מע״מ 18% → סה״כ כולל מע״מ → הנחה כולל מע״מ → סכום לתשלום
// i.e. the LIST price (before discount), then the discount as a visible
// subtraction down to the amount actually due. Two decimals (agorot) so the
// lines add up. The final "סכום לתשלום" equals the stored quote/order total.
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const money = (n) => `₪${(Number(n) || 0).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function Row({ label, value, className = '', strong = false }) {
  return (
    <div className={`flex justify-between text-sm ${className}`}>
      <span className={strong ? 'font-semibold text-foreground' : 'text-muted-foreground'}>{label}</span>
      <span className={strong ? 'font-bold' : 'font-medium'}>{value}</span>
    </div>
  );
}

export default function QuoteTotalsSummary({ items = [], extras = [], discountTotal = 0 }) {
  // GROSS (list, before discount) items subtotal, pre-VAT.
  const itemsGrossPreVat = round2(
    (items || []).reduce((sum, it) => {
      const addonsPrice = (it.selected_addons || []).reduce((a, x) => a + (x.price || 0), 0);
      return sum + (it.quantity || 1) * ((it.unit_price || 0) + addonsPrice);
    }, 0),
  );
  const discPreVat = round2(discountTotal);
  const extrasIncl = round2((extras || []).reduce((s, e) => s + (e.cost || 0), 0));

  const grossVat = round2(itemsGrossPreVat * 0.18);
  const grossInclVat = round2(itemsGrossPreVat * 1.18 + extrasIncl); // total incl VAT, before discount
  const discInclVat = round2(discPreVat * 1.18);
  const toPay = round2(grossInclVat - discInclVat); // == stored total (items net *1.18 + extras)
  const hasDiscount = discInclVat > 0;

  return (
    <div className="mt-6 border border-border rounded-xl overflow-hidden">
      <div className="p-4 space-y-3 bg-muted/40">
        <Row label="סכום לפני מע״מ" value={money(itemsGrossPreVat)} />
        <Row label="מע״מ (18%)" value={money(grossVat)} />
        <Row label="סה״כ כולל מע״מ" value={money(grossInclVat)} strong />
        {hasDiscount ? (
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
