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
  if (n >= 30) return { dot: 'bg-emerald-500', label: 'text-emerald-700', bg: 'bg-emerald-50' };
  if (n >= 15) return { dot: 'bg-amber-500', label: 'text-amber-700', bg: 'bg-amber-50' };
  return { dot: 'bg-red-500', label: 'text-red-700', bg: 'bg-red-50' };
}

export default function TeamTab({ current = {} }) {
  const reps = [...(current.reps || [])].sort((a, b) => (b.revenue || 0) - (a.revenue || 0));

  return (
    <Card className="border-border shadow-card">
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
            <div className="grid grid-cols-12 gap-2 px-4 py-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide bg-muted/40">
              <div className="col-span-4">נציג</div>
              <div className="col-span-2 text-center">לידים</div>
              <div className="col-span-2 text-center">נסגרו</div>
              <div className="col-span-2 text-center">המרה</div>
              <div className="col-span-2 text-end">הכנסות</div>
            </div>
            {reps.map((rep, idx) => {
              const tier = tierFor(rep.conversion);
              const isTop = idx === 0;
              const displayName = rep.full_name || rep.email || 'לא ידוע';
              return (
                <div
                  key={rep.email || displayName}
                  className="grid grid-cols-12 gap-2 px-4 py-2.5 text-sm items-center hover:bg-muted/30 transition-colors"
                >
                  <div className="col-span-4 flex items-center gap-2 min-w-0">
                    {isTop ? (
                      <Crown className="h-4 w-4 text-amber-500 flex-shrink-0" />
                    ) : (
                      <span className={`h-2 w-2 rounded-full ${tier.dot} flex-shrink-0`} />
                    )}
                    <span className="font-semibold text-foreground truncate" title={displayName}>
                      {displayName}
                    </span>
                  </div>
                  <div className="col-span-2 text-center text-muted-foreground">{rep.leads_count || 0}</div>
                  <div className="col-span-2 text-center text-muted-foreground">{rep.won_count || 0}</div>
                  <div className="col-span-2 text-center">
                    <span className={`inline-block px-2 py-0.5 rounded-md text-xs font-semibold ${tier.label} ${tier.bg}`}>
                      {Number(rep.conversion || 0).toFixed(0)}%
                    </span>
                  </div>
                  <div className="col-span-2 text-end font-bold text-foreground">
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
