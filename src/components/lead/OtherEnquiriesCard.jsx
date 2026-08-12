import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { History, ArrowLeft } from 'lucide-react';
import StatusBadge from '@/components/shared/StatusBadge';
import { format } from '@/lib/safe-date-fns';
import { parseDbTimestamp } from '@/lib/safe-date-fns-tz';
import { createPageUrl } from '@/utils';
import SourceBadge from '@/components/shared/SourceBadge';

/**
 * "This person has enquired before" — every other lead sharing this lead's
 * contact, one per row.
 *
 * Every lead is attached to a contact by normalized phone at the database
 * level, and a repeat enquiry deliberately creates its own lead row so the
 * daily count matches what the ad networks report. That left a gap on screen:
 * a rep opening one of those rows had no way to see the others, and would work
 * a returning customer as a stranger.
 *
 * It was a single strip at the foot of the page showing only the most recent
 * previous enquiry, with the others reduced to "ועוד 2" — a count with nothing
 * behind it. The whole history was already being fetched; only one row of it
 * was ever drawn. Now every enquiry is a row you can open, and the list scrolls
 * inside its own box so a contact with eight enquiries doesn't stretch the
 * column. Renders nothing at all when the contact has no other leads, which is
 * the common case.
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
          // by, so this agrees with the order the rep already knows.
          const da = parseDbTimestamp(a.effective_sort_date || a.created_date);
          const db = parseDbTimestamp(b.effective_sort_date || b.created_date);
          return (db?.getTime() || 0) - (da?.getTime() || 0);
        });
    },
  });

  if (!contactId || siblings.length === 0) return null;

  return (
    <section className="rounded-2xl border border-indigo-200 bg-card shadow-card overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3">
        <span className="inline-flex items-center gap-2 text-sm font-bold text-indigo-700 min-w-0">
          <History className="h-4 w-4 flex-shrink-0" />
          פניות נוספות מאותו אדם
          <span className="inline-flex items-center justify-center rounded-full px-1.5 min-w-[18px] h-[18px] text-[10px] font-bold leading-none bg-indigo-100 text-indigo-700">
            {siblings.length}
          </span>
        </span>
      </div>

      <ul className="list-none m-0 p-0 max-h-[200px] overflow-y-auto">
        {siblings.map((enquiry) => {
          const when = parseDbTimestamp(enquiry.effective_sort_date || enquiry.created_date);
          return (
            <li key={enquiry.id} className="border-t border-border/50 first:border-t-0">
              <Link
                to={`${createPageUrl('LeadDetails')}?id=${enquiry.id}`}
                className="flex items-center gap-2 px-4 py-2 hover:bg-indigo-50/60 transition-colors"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 flex-wrap">
                    <StatusBadge status={enquiry.status} />
                    <SourceBadge source={enquiry.source} />
                  </span>
                  {when ? (
                    <span className="block mt-1 text-[11px] text-muted-foreground/70 tabular-nums">
                      {format(when, 'dd/MM/yyyy')}
                    </span>
                  ) : null}
                </span>
                <ArrowLeft className="h-3.5 w-3.5 text-indigo-600 flex-none" />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
