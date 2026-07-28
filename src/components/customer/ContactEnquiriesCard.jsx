import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { MessageSquare, ArrowLeft, Calendar } from 'lucide-react';
import { format } from '@/lib/safe-date-fns';
import { parseDbTimestamp } from '@/lib/safe-date-fns-tz';
import { createPageUrl } from '@/utils';
import { LEAD_STATUS_OPTIONS, SOURCE_LABELS } from '@/constants/leadOptions';

const STATUS_LABEL = Object.fromEntries(
  LEAD_STATUS_OPTIONS.map((s) => [s.value, s.label]),
);

// Marketing attribution, in the order a person reads it: which channel, then
// which campaign, then which specific ad, then the mechanics. Labels match the
// lead screen so the same field is never called two things.
const DETAIL_FIELDS = [
  { key: 'source_form',       label: 'טופס מקור' },
  { key: 'facebook_campaign_name', label: 'קמפיין' },
  { key: 'facebook_ad_name',  label: 'מודעה' },
  { key: 'utm_campaign',      label: 'UTM קמפיין' },
  { key: 'utm_source',        label: 'UTM מקור' },
  { key: 'utm_medium',        label: 'UTM מדיום' },
  { key: 'utm_content',       label: 'UTM תוכן' },
  { key: 'utm_term',          label: 'UTM מונח' },
  { key: 'landing_page',      label: 'דף נחיתה' },
  { key: 'subject',           label: 'נושא הפנייה' },
  { key: 'rep1',              label: 'נציג ראשי' },
  { key: 'rep2',              label: 'נציג משני' },
];

/**
 * Every enquiry this contact has ever made, in full.
 *
 * The customer screen showed orders, revenue and LTV but nothing about how the
 * person got here — its timeline had only "customer created". Worse, the page
 * resolves a single lead through the legacy customer.lead_id field, so someone
 * who enquired three times looked like they enquired once.
 *
 * This reads the real link instead: leads.contact_id, set by a database trigger
 * on every lead from every entry path. Each enquiry is shown with its date and
 * its full marketing attribution, because the question this answers is not just
 * "did they come back" but "which ad brought them back".
 *
 * Only fields with a value are rendered — leads arriving by phone or manual
 * entry carry no UTMs, and printing a column of dashes would bury the rows that
 * do have attribution.
 */
export default function ContactEnquiriesCard({ customerId }) {
  const { data: leads = [], isLoading } = useQuery({
    queryKey: ['contact-enquiries', customerId],
    enabled: !!customerId,
    staleTime: 60_000,
    queryFn: async () => {
      const rows = await base44.entities.Lead.filter({ contact_id: customerId });
      if (!Array.isArray(rows)) return [];
      return rows.slice().sort((a, b) => {
        const da = parseDbTimestamp(a.effective_sort_date || a.created_date);
        const db = parseDbTimestamp(b.effective_sort_date || b.created_date);
        return (db?.getTime() || 0) - (da?.getTime() || 0);
      });
    },
  });

  if (!customerId || isLoading) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-muted-foreground" />
          פניות
        </CardTitle>
        <Badge variant="outline">{leads.length.toLocaleString('he-IL')}</Badge>
      </CardHeader>

      <CardContent className="p-0">
        {leads.length === 0 ? (
          // Not an error: contacts also arrive from order imports and manual
          // entry, neither of which creates a lead.
          <p className="px-6 pb-6 text-sm text-muted-foreground">
            לא נמצאו פניות המשויכות לאיש הקשר הזה.
          </p>
        ) : (
          <ul className="divide-y divide-border/60">
            {leads.map((l, idx) => {
              const when = parseDbTimestamp(l.effective_sort_date || l.created_date);
              const details = DETAIL_FIELDS
                .map((f) => ({ ...f, value: l[f.key] }))
                .filter((f) => f.value != null && String(f.value).trim() !== '');

              return (
                <li key={l.id} className="px-6 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {/* Newest first, so #1 is the most recent enquiry. */}
                        <span className="text-xs text-muted-foreground tabular-nums">
                          #{leads.length - idx}
                        </span>
                        <span className="text-sm font-semibold text-foreground">
                          {STATUS_LABEL[l.status] || l.status || 'ללא סטטוס'}
                        </span>
                        {l.source ? (
                          <Badge variant="secondary" className="text-[11px]">
                            {SOURCE_LABELS[l.source] || l.source}
                          </Badge>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-1.5 mt-1 text-xs text-muted-foreground">
                        <Calendar className="h-3 w-3" />
                        <span className="tabular-nums">
                          {when ? format(when, 'dd/MM/yyyy HH:mm') : '—'}
                        </span>
                      </div>
                    </div>

                    <Link
                      to={`${createPageUrl('LeadDetails')}?id=${l.id}`}
                      className="flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80 shrink-0"
                    >
                      פתח ליד
                      <ArrowLeft className="h-3.5 w-3.5" />
                    </Link>
                  </div>

                  {details.length > 0 ? (
                    <dl className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
                      {details.map((f) => (
                        <div key={f.key} className="flex items-baseline gap-2 min-w-0">
                          <dt className="text-[11px] text-muted-foreground/80 w-24 shrink-0">
                            {f.label}
                          </dt>
                          <dd className="text-xs text-foreground truncate" title={String(f.value)}>
                            {String(f.value)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  ) : (
                    <p className="mt-2 text-xs text-muted-foreground/70">
                      אין פרטי שיווק לפנייה זו.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
