import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { History, ArrowLeft } from 'lucide-react';
import { format } from '@/lib/safe-date-fns';
import { parseDbTimestamp } from '@/lib/safe-date-fns-tz';
import { createPageUrl } from '@/utils';
import { LEAD_STATUS_OPTIONS, formatSourceLabel } from '@/constants/leadOptions';

const STATUS_LABEL = Object.fromEntries(
  LEAD_STATUS_OPTIONS.map((s) => [s.value, s.label]),
);

/**
 * "This person has enquired before" — the other leads sharing this lead's
 * contact.
 *
 * Every lead is attached to a contact by normalized phone at the database
 * level, and a repeat enquiry deliberately creates its own lead row so the
 * daily count matches what the ad networks report. That left a gap on screen:
 * a rep opening one of those rows had no way to see the others, and would work
 * a returning customer as a stranger.
 *
 * Renders nothing at all when the contact has no other leads, which is the
 * common case — a first-time enquiry should not carry an empty card.
 */
export default function OtherEnquiriesCard({ lead }) {
  const contactId = lead?.contact_id || null;

  const { data: siblings = [] } = useQuery({
    queryKey: ['lead-other-enquiries', contactId, lead?.id],
    enabled: !!contactId && !!lead?.id,
    staleTime: 60_000,
    queryFn: async () => {
      const rows = await base44.entities.Lead.filter({ contact_id: contactId });
      if (!Array.isArray(rows)) return [];
      return rows
        .filter((r) => r?.id && r.id !== lead.id)
        .sort((a, b) => {
          // Newest first. effective_sort_date is what the leads list orders
          // by, so this card agrees with the order the rep already knows.
          const da = parseDbTimestamp(a.effective_sort_date || a.created_date);
          const db = parseDbTimestamp(b.effective_sort_date || b.created_date);
          return (db?.getTime() || 0) - (da?.getTime() || 0);
        });
    },
  });

  if (!contactId || siblings.length === 0) return null;

  return (
    <Card className="rounded-xl border-border shadow-card overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between border-b border-border/50 bg-amber-50/60 py-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <History className="h-4 w-4 text-amber-600" />
          לידים נוספים מאותו אדם
        </CardTitle>
        <Badge variant="outline" className="bg-white">
          {siblings.length.toLocaleString('he-IL')}
        </Badge>
      </CardHeader>

      <CardContent className="p-0">
        <ul className="divide-y divide-border/60">
          {siblings.map((s) => {
            const when = parseDbTimestamp(s.effective_sort_date || s.created_date);
            return (
              <li key={s.id}>
                <Link
                  to={`${createPageUrl('LeadDetails')}?id=${s.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/50 transition-colors"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-foreground truncate">
                      {STATUS_LABEL[s.status] || s.status || 'ללא סטטוס'}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {[formatSourceLabel(s.source), s.rep1].filter(Boolean).join(' · ') || '—'}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {when ? format(when, 'dd/MM/yyyy') : '—'}
                    </span>
                    <ArrowLeft className="h-4 w-4 text-muted-foreground" />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
