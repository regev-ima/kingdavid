import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ListChecks, ChevronLeft } from 'lucide-react';
import {
  LEAD_STATUS_OPTIONS,
  CLOSED_STATUSES,
} from '@/constants/leadOptions';

const LABEL_BY_VALUE = Object.fromEntries(LEAD_STATUS_OPTIONS.map((s) => [s.value, s.label]));
const CLOSED_SET = new Set(CLOSED_STATUSES);

// Single status row gets a colored stripe + the rep's open/closed tone
// so the table reads at a glance even at 80 char width.
function toneFor(status, label) {
  if (status === 'deal_closed') return { stripe: 'bg-emerald-500', text: 'text-emerald-700', badge: 'bg-emerald-50' };
  if (CLOSED_SET.has(status))    return { stripe: 'bg-slate-400',  text: 'text-slate-600',  badge: 'bg-slate-50' };
  if (String(label).includes('ללא מענה') || String(label).includes('אין מענה')) {
    return { stripe: 'bg-amber-500', text: 'text-amber-700', badge: 'bg-amber-50' };
  }
  if (status === 'hot_lead')     return { stripe: 'bg-rose-500',    text: 'text-rose-700',    badge: 'bg-rose-50' };
  if (status === 'new_lead')     return { stripe: 'bg-blue-500',    text: 'text-blue-700',    badge: 'bg-blue-50' };
  return                                { stripe: 'bg-indigo-400',  text: 'text-indigo-700',  badge: 'bg-indigo-50' };
}

async function fetchStatusCounts() {
  // Only the status column — cheap even on tables with many rows since
  // there are no joins or large blob columns to drag back.
  const { data, error } = await supabase.from('leads').select('status');
  if (error) throw error;
  const counts = new Map();
  for (const row of data || []) {
    const s = row?.status || 'unknown';
    counts.set(s, (counts.get(s) || 0) + 1);
  }
  return Object.fromEntries(counts);
}

// Plausible distribution for demo mode so the table looks alive without
// hitting Supabase. Numbers are arbitrary but proportioned roughly like
// a real funnel (most leads "open / followup", fewer urgent or won).
function demoStatusCounts() {
  return {
    new_lead: 84,
    hot_lead: 23,
    followup_before_quote: 41,
    followup_after_quote: 36,
    coming_to_branch: 12,
    no_answer_1: 28,
    no_answer_2: 19,
    no_answer_3: 11,
    no_answer_4: 6,
    no_answer_5: 3,
    no_answer_whatsapp_sent: 14,
    no_answer_calls: 9,
    changed_direction: 5,
    deal_closed: 67,
    not_relevant_duplicate: 22,
    mailing_remove_request: 8,
    lives_far_phone_concern: 4,
    products_not_available: 6,
    not_relevant_bought_elsewhere: 17,
    not_relevant_1000_nis: 9,
    not_relevant_denies_contact: 7,
    not_relevant_service: 5,
    not_interested_hangs_up: 13,
    not_relevant_no_explanation: 10,
    heard_price_not_interested: 26,
    not_relevant_wrong_number: 11,
    closed_by_manager_to_mailing: 4,
  };
}

export default function LeadsByStatusTable({ demoMode = false }) {
  const { data: counts, isLoading } = useQuery({
    queryKey: ['leadsByStatus', { demo: demoMode }],
    queryFn: () => (demoMode ? Promise.resolve(demoStatusCounts()) : fetchStatusCounts()),
    staleTime: 60 * 1000,
    placeholderData: (prev) => prev,
  });

  const { rows, total, openTotal, closedTotal, wonTotal } = useMemo(() => {
    const map = counts || {};
    // Catalogued rows first (in the canonical order from leadOptions),
    // then any "unknown" status that's in the DB but not in our enum —
    // surfaces drift between the front-end constants and what the DB
    // actually has.
    const known = LEAD_STATUS_OPTIONS.map((opt) => ({
      status: opt.value,
      label: opt.label,
      count: Number(map[opt.value] || 0),
    }));
    const extraKeys = Object.keys(map).filter((k) => !LABEL_BY_VALUE[k]);
    const extras = extraKeys.map((k) => ({
      status: k,
      label: k === 'unknown' ? 'ללא סטטוס' : k,
      count: Number(map[k] || 0),
    }));
    const all = [...known, ...extras].sort((a, b) => b.count - a.count);
    const total = all.reduce((s, r) => s + r.count, 0);
    const openTotal = all.filter((r) => !CLOSED_SET.has(r.status)).reduce((s, r) => s + r.count, 0);
    const closedTotal = total - openTotal;
    const wonTotal = Number(map['deal_closed'] || 0);
    return { rows: all, total, openTotal, closedTotal, wonTotal };
  }, [counts]);

  return (
    <Card className="border-border shadow-card" dir="rtl">
      <CardHeader className="pb-2 border-b border-border/50">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <ListChecks className="h-4 w-4 text-indigo-600" />
            לידים לפי סטטוס
          </CardTitle>
          <Link to={createPageUrl('Leads')} className="text-xs text-primary hover:text-primary/80 inline-flex items-center gap-1">
            לרשימת הלידים
            <ChevronLeft className="h-3.5 w-3.5" />
          </Link>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {/* Top totals strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 border-b border-border/50">
          <div className="bg-muted/30 rounded-md p-3 text-right">
            <p className="text-xs text-muted-foreground">סה״כ לידים</p>
            <p className="text-xl font-bold mt-1">{total.toLocaleString()}</p>
          </div>
          <div className="bg-indigo-50 rounded-md p-3 text-right">
            <p className="text-xs text-indigo-700/80">פתוחים</p>
            <p className="text-xl font-bold text-indigo-700 mt-1">{openTotal.toLocaleString()}</p>
          </div>
          <div className="bg-emerald-50 rounded-md p-3 text-right">
            <p className="text-xs text-emerald-700/80">נסגרו עסקה</p>
            <p className="text-xl font-bold text-emerald-700 mt-1">{wonTotal.toLocaleString()}</p>
          </div>
          <div className="bg-slate-50 rounded-md p-3 text-right">
            <p className="text-xs text-slate-600">סגורים (כולל לא רלוונטי)</p>
            <p className="text-xl font-bold text-slate-700 mt-1">{closedTotal.toLocaleString()}</p>
          </div>
        </div>

        {isLoading && !counts ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-7 w-full" />)}
          </div>
        ) : rows.length === 0 || total === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            אין נתוני לידים להציג
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2 text-right font-semibold">סטטוס</th>
                  <th className="px-3 py-2 text-center font-semibold w-20">לידים</th>
                  <th className="px-3 py-2 text-center font-semibold w-16">%</th>
                  <th className="px-4 py-2 text-right font-semibold">חלוקה</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {rows.map((row) => {
                  const tone = toneFor(row.status, row.label);
                  const pct = total > 0 ? (row.count / total) * 100 : 0;
                  return (
                    <tr key={row.status} className="hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={`h-2.5 w-2.5 rounded-full ${tone.stripe} flex-shrink-0`} />
                          <span className="truncate" title={row.label}>{row.label}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span className={`inline-block min-w-[2.5rem] px-2 py-0.5 rounded-md font-semibold ${tone.badge} ${tone.text}`}>
                          {row.count.toLocaleString()}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-center text-xs text-muted-foreground tabular-nums">
                        {pct.toFixed(1)}%
                      </td>
                      <td className="px-4 py-2">
                        <div className="h-1.5 w-full rounded-full bg-muted/40 overflow-hidden">
                          <div className={`h-full ${tone.stripe}`} style={{ width: `${Math.min(100, pct)}%` }} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
