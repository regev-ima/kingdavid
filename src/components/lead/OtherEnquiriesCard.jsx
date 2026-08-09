import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { History, ArrowLeft } from 'lucide-react';
import StatusBadge from '@/components/shared/StatusBadge';
import { format } from '@/lib/safe-date-fns';
import { parseDbTimestamp } from '@/lib/safe-date-fns-tz';
import { createPageUrl } from '@/utils';
import { formatSourceLabel } from '@/constants/leadOptions';

/**
 * "This person has enquired before" — the other leads sharing this lead's
 * contact, as one line.
 *
 * Every lead is attached to a contact by normalized phone at the database
 * level, and a repeat enquiry deliberately creates its own lead row so the
 * daily count matches what the ad networks report. That left a gap on screen:
 * a rep opening one of those rows had no way to see the others, and would work
 * a returning customer as a stranger.
 *
 * It used to be a full card — header, count badge, a bordered list — for what
 * is nearly always a single previous enquiry. Now it's one strip: the most
 * recent previous enquiry inline, and a link into it. Renders nothing at all
 * when the contact has no other leads, which is the common case.
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

  const latest = siblings[0];
  const when = parseDbTimestamp(latest.effective_sort_date || latest.created_date);
  const source = formatSourceLabel(latest.source);
  const rest = siblings.length - 1;

  return (
    <div className="flex items-center gap-2.5 flex-wrap rounded-xl border border-indigo-200 bg-indigo-50/60 px-3 py-2 text-[13px]">
      <span className="inline-flex items-center gap-1.5 font-semibold text-indigo-700 flex-shrink-0">
        <History className="h-3.5 w-3.5" />
        פנייה נוספת מאותו אדם
      </span>

      <span className="inline-flex items-center gap-2 min-w-0 text-muted-foreground">
        <StatusBadge status={latest.status} />
        <span className="truncate">
          {[when ? format(when, 'dd/MM/yyyy') : null, source].filter(Boolean).join(' · ')}
        </span>
      </span>

      {rest > 0 ? (
        <span className="text-[11px] text-indigo-700/70 flex-shrink-0">
          ועוד {rest.toLocaleString('he-IL')}
        </span>
      ) : null}

      <Link
        to={`${createPageUrl('LeadDetails')}?id=${latest.id}`}
        className="inline-flex items-center gap-1 font-medium text-indigo-700 hover:underline flex-shrink-0 ms-auto"
      >
        פתח את הליד הקודם
        <ArrowLeft className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}
