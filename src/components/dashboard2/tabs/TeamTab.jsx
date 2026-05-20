import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { ChevronLeft, TrendingUp, Crown } from 'lucide-react';

function formatCurrency(value) {
  return `₪${Number(value || 0).toLocaleString()}`;
}

function tierFor(conv) {
  const n = Number(conv ?? 0);
  if (n >= 30) return { dot: 'bg-emerald-500' };
  if (n >= 15) return { dot: 'bg-amber-500' };
  return { dot: 'bg-red-500' };
}

function Pct({ value, tone }) {
  const toneClass = {
    emerald: 'text-emerald-700 bg-emerald-50',
    amber: 'text-amber-700 bg-amber-50',
    red: 'text-red-700 bg-red-50',
  }[tone];
  return (
    <span className={`inline-block px-2 py-0.5 rounded-md text-xs font-semibold ${toneClass}`}>
      {Number(value || 0).toFixed(0)}%
    </span>
  );
}

export default function TeamTab({ current = {} }) {
  const reps = [...(current.reps || [])].sort((a, b) => (b.revenue || 0) - (a.revenue || 0));

  return (
    <Card className="border-border shadow-card" dir="rtl">
      <CardHeader className="pb-2 border-b border-border/50">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-indigo-600" />
            ביצועי כל הנציגים
          </CardTitle>
          <Link to={createPageUrl('Representatives')}>
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1">
              לדף הנציגים
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
          </Link>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {reps.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            אין נתוני נציגים בטווח שנבחר
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            <div className="grid grid-cols-14 gap-2 px-4 py-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide bg-muted/40" style={{ gridTemplateColumns: 'minmax(0, 3fr) repeat(5, minmax(0, 1.5fr)) minmax(0, 2fr)' }}>
              <div className="text-right">נציג</div>
              <div className="text-center">לידים</div>
              <div className="text-center">סגירה</div>
              <div className="text-center">בטיפול</div>
              <div className="text-center">אבד / עבר זמן</div>
              <div className="text-center">נסגרו</div>
              <div className="text-end">הכנסות</div>
            </div>
            {reps.map((rep, idx) => {
              const conv = Number(rep.conversion || 0);
              const inHandling = Number(rep.in_handling_rate || 0);
              const lost = Number(rep.lost_rate || 0);
              const tier = tierFor(conv);
              const isTop = idx === 0;
              const displayName = rep.full_name || rep.email || 'לא ידוע';
              return (
                <div
                  key={rep.email || displayName}
                  className="grid gap-2 px-4 py-2.5 text-sm items-center hover:bg-muted/30 transition-colors"
                  style={{ gridTemplateColumns: 'minmax(0, 3fr) repeat(5, minmax(0, 1.5fr)) minmax(0, 2fr)' }}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {isTop ? (
                      <Crown className="h-4 w-4 text-amber-500 flex-shrink-0" />
                    ) : (
                      <span className={`h-2 w-2 rounded-full ${tier.dot} flex-shrink-0`} />
                    )}
                    <span className="font-semibold text-foreground truncate" title={displayName}>
                      {displayName}
                    </span>
                  </div>
                  <div className="text-center text-muted-foreground">{rep.leads_count || 0}</div>
                  <div className="text-center"><Pct value={conv} tone="emerald" /></div>
                  <div className="text-center"><Pct value={inHandling} tone="amber" /></div>
                  <div className="text-center"><Pct value={lost} tone="red" /></div>
                  <div className="text-center text-muted-foreground">{rep.won_count || 0}</div>
                  <div className="text-end font-bold text-foreground whitespace-nowrap">
                    {formatCurrency(rep.revenue)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
