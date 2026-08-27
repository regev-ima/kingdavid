import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import InfoTip from './InfoTip';

// The treatment funnel: every stage as a share of the leads that entered, with
// the step-to-step drop spelled out. This is where "הקמפיין לא עובד" and
// "הלידים לא מטופלים" stop being the same complaint.
const STAGES = [
  { key: 'leads', label: 'לידים', tone: 'bg-indigo-500' },
  { key: 'contacted', label: 'טופלו (שיחה ראשונה)', tone: 'bg-blue-500' },
  { key: 'quoted', label: 'קיבלו הצעת מחיר', tone: 'bg-amber-500' },
  { key: 'won', label: 'נסגרה עסקה', tone: 'bg-emerald-500' },
];

export default function MarketingFunnelCard({ totals }) {
  const base = Number(totals?.leads || 0);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-1.5">
          משפך טיפול
          <InfoTip title="משפך טיפול">
            <p>כמה מהלידים של התקופה עברו כל שלב בדרך לעסקה: נכנסו ← דיברו איתם ← קיבלו הצעת מחיר ← סגרו.</p>
            <p>נפילה חדה בין "לידים" ל"טופלו" = בעיה במוקד, לא בקמפיינים. נפילה בין "טופלו" ל"נסגרה עסקה" = בעיה באיכות הלידים או בתהליך המכירה.</p>
            <p><b>הערה על הצעות מחיר:</b> נספרות רק הצעות שהופקו מהמערכת. עסקאות רבות נסגרות בטלפון בלי הצעה רשומה — לכן "נסגרה עסקה" יכול להיות גבוה מ"קיבלו הצעת מחיר", ואז מוצג האחוז מכלל הלידים במקום מהשלב הקודם.</p>
          </InfoTip>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-2.5">
        {STAGES.map((stage, i) => {
          const value = Number(totals?.[stage.key] || 0);
          const prevValue = i === 0 ? value : Number(totals?.[STAGES[i - 1].key] || 0);
          const ofBase = base > 0 ? (value / base) * 100 : 0;
          const ofPrev = prevValue > 0 ? (value / prevValue) * 100 : 0;
          // A stage can legitimately exceed the previous one (deals close with
          // no recorded quote) — "847% מהשלב הקודם" reads like a bug, so fall
          // back to the share of all leads.
          const stepLabel = i === 0 ? null
            : value > prevValue
              ? `${ofBase.toFixed(0)}% מכלל הלידים`
              : `${ofPrev.toFixed(0)}% מהשלב הקודם`;
          return (
            <div key={stage.key}>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="font-medium text-foreground">{stage.label}</span>
                <span className="tabular-nums text-muted-foreground">
                  <b className="text-foreground">{value.toLocaleString()}</b>
                  {stepLabel && <span className="ms-1.5">({stepLabel})</span>}
                </span>
              </div>
              <div className="h-2.5 rounded-full bg-muted/40 overflow-hidden">
                <div className={`h-full rounded-full ${stage.tone}`} style={{ width: `${Math.max(ofBase, value > 0 ? 2 : 0)}%` }} />
              </div>
            </div>
          );
        })}
        {base > 0 && (
          <p className="text-[11px] text-muted-foreground pt-1">
            המרה כוללת: <b className="text-foreground">{(totals.conversion || 0).toFixed(1)}%</b>
            {totals?.open > 0 && <> · עדיין בטיפול: <b className="text-foreground">{Number(totals.open).toLocaleString()}</b></>}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
