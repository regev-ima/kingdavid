import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronRight, FileText } from 'lucide-react';
import { format } from 'date-fns';
import { he } from 'date-fns/locale';
import StatusBadge from '@/components/shared/StatusBadge';
import { fetchAllList } from '@/lib/base44Pagination';

export default function PendingQuotesCard({ leadsById, effectiveUser }) {
  const isAdmin = effectiveUser?.role === 'admin';
  const email = effectiveUser?.email?.toLowerCase();

  const { data: quotes = [] } = useQuery({
    queryKey: ['pendingQuotes', 'dashboard'],
    queryFn: async () => {
      const all = await fetchAllList(base44.entities.Quote, '-created_date');
      return all.filter(q => !['approved', 'rejected', 'expired'].includes(q.status));
    },
    staleTime: 60000,
    enabled: !!effectiveUser,
  });

  // Filter quotes by user scope
  const scopedQuotes = React.useMemo(() => {
    if (isAdmin) return quotes;
    return quotes.filter(q => {
      if (q.created_by?.toLowerCase() === email) return true;
      if (q.created_by_rep?.toLowerCase() === email) return true;
      if (q.lead_id && leadsById[q.lead_id]) {
        const lead = leadsById[q.lead_id];
        if (lead.rep1?.toLowerCase() === email) return true;
        if (lead.rep2?.toLowerCase() === email) return true;
      }
      return false;
    });
  }, [quotes, isAdmin, email, leadsById]);

  const STATUS_LABEL = { draft: 'טיוטה', sent: 'נשלחה' };
  const STATUS_STYLE = { draft: 'bg-slate-100 text-slate-700', sent: 'bg-blue-100 text-blue-700' };

  const today = new Date();
  const openQuotes = scopedQuotes.filter(q => !q.valid_until || new Date(q.valid_until) >= today);
  const expiredQuotes = scopedQuotes.filter(q => q.valid_until && new Date(q.valid_until) < today);
  const openTotal = openQuotes.reduce((sum, q) => sum + (q.total || 0), 0);
  const expiredTotal = expiredQuotes.reduce((sum, q) => sum + (q.total || 0), 0);

  return (
    <Card className="overflow-hidden shadow-sm border-purple-200">
      <CardHeader className="pb-3 bg-gradient-to-l from-purple-50 to-purple-100/50">
        <CardTitle className="flex items-center justify-between text-base">
          <span className="flex items-center gap-2.5">
            <div className="rounded-xl p-2.5 bg-purple-100">
              <FileText className="h-5 w-5 text-purple-600" />
            </div>
            <div>
              <span className="font-bold">הצעות מחיר ממתינות</span>
              <span className="ms-2 inline-flex items-center justify-center rounded-full px-2 py-0.5 text-xs font-bold text-white bg-purple-500">
                {scopedQuotes.length}
              </span>
            </div>
          </span>
          <Link to={createPageUrl('Quotes')}>
            <Button variant="ghost" size="sm" className="text-xs">
              הכל
              <ChevronRight className="me-1 h-3.5 w-3.5" />
            </Button>
          </Link>
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-0.5">הצעות מחיר בסטטוס טיוטה/נשלחה שטרם נסגרו</p>
      </CardHeader>
      {scopedQuotes.length > 0 && (
        <div className="px-4 py-2.5 border-b border-purple-100 bg-white flex gap-4 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            <span className="text-muted-foreground">פתוחות:</span>
            <span className="font-bold text-foreground">{openQuotes.length}</span>
            <span className="text-muted-foreground">•</span>
            <span className="font-semibold text-emerald-700">₪{Math.round(openTotal).toLocaleString()}</span>
          </div>
          {expiredQuotes.length > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="inline-flex h-2 w-2 rounded-full bg-red-500" />
              <span className="text-muted-foreground">פג תוקף:</span>
              <span className="font-bold text-foreground">{expiredQuotes.length}</span>
              <span className="text-muted-foreground">•</span>
              <span className="font-semibold text-red-600">₪{Math.round(expiredTotal).toLocaleString()}</span>
            </div>
          )}
        </div>
      )}
      <CardContent className="p-3 space-y-2 max-h-[520px] overflow-y-auto">
        {scopedQuotes.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">אין הצעות מחיר ממתינות</p>
        ) : (
          scopedQuotes.map((quote) => {
            const lead = quote.lead_id ? leadsById[quote.lead_id] : null;
            return (
              <Link
                key={quote.id}
                to={createPageUrl('QuoteDetails') + `?id=${quote.id}`}
                className="flex w-full items-center gap-3 rounded-xl border border-purple-200 p-3 text-start transition-all hover:bg-purple-50/60 hover:shadow-sm"
              >
                <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-purple-50 text-base">
                  📝
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground">
                    {quote.customer_name || 'ללא שם'}
                    {quote.quote_number && <span className="text-muted-foreground font-normal ms-1">#{quote.quote_number}</span>}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {quote.total ? `₪${quote.total.toLocaleString()}` : ''}
                    {quote.valid_until ? ` • תוקף: ${format(new Date(quote.valid_until), 'EEEE dd/MM', { locale: he })}` : ''}
                  </p>
                </div>
                {lead?.status && (
                  <div className="flex-shrink-0">
                    <StatusBadge status={lead.status} />
                  </div>
                )}
                <div className="text-left flex-shrink-0">
                  <Badge className={`text-[11px] ${STATUS_STYLE[quote.status] || 'bg-slate-100 text-slate-700'}`}>
                    {STATUS_LABEL[quote.status] || quote.status}
                  </Badge>
                </div>
              </Link>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}