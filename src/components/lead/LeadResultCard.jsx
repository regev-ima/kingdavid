import React from 'react';
import StatusBadge from '@/components/shared/StatusBadge';
import RepeatEnquiryBadge from '@/components/lead/RepeatEnquiryBadge';
import { Phone, ArrowLeft, Users, Calendar } from 'lucide-react';
import { SOURCE_LABELS } from '@/constants/leadOptions';
import { getRepDisplayName } from '@/lib/repDisplay';
import { parseDbTimestamp, formatInTimeZone } from '@/lib/safe-date-fns-tz';
import { formatIsraeliPhone as formatPhone } from '@/utils/phoneUtils';

/**
 * One lead, as a search result: who they are, whether they are already in the
 * system twice, what state their enquiry is in, where it came from, how old it
 * is, and whose desk it is on — plus a call button that doesn't require opening
 * anything.
 *
 * Lifted out of LeadLookupPanel so the global search can render the same card.
 * Its leads used to be two lines of plain text — a name and "phone • email" —
 * which meant a rep searching from the header got no duplicate warning and no
 * owner, the two facts that decide what to do next. One card, one answer, no
 * matter which search box asked the question.
 *
 * Props:
 *   lead        — the lead row (needs status, source, rep1/rep2/pending_rep_email,
 *                 contact_id, created_date beyond the obvious fields)
 *   users       — the roster, to turn a rep's email into their name
 *   repeatEntry — { ordinal, total } from useRepeatEnquiries, or undefined
 *   onOpen      — called when the card is clicked
 */

export default function LeadResultCard({ lead, users, repeatEntry, onOpen }) {
  const ownerEmail = lead.rep1 || lead.pending_rep_email || lead.rep2 || null;
  // The rep's name, not their mailbox. A card that says
  // "misgavkingdavid@gmail.com" makes the reader translate an address into a
  // person before they can act on it; getRepDisplayName falls back to the
  // email only when the roster genuinely has no user for it.
  const ownerName = ownerEmail ? getRepDisplayName(ownerEmail, users) : null;
  const sourceLabel = lead.source ? (SOURCE_LABELS[lead.source] || lead.source) : null;
  const callHref = lead.phone ? `tel:${lead.phone}` : null;
  // Creation date, always — "how old is this enquiry?" is part of deciding
  // what to do with it, and it shouldn't take opening the lead to answer.
  const createdAt = parseDbTimestamp(lead.created_date);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full text-right rounded-xl border border-border bg-card p-4 shadow-card hover:shadow-card-hover hover:border-primary/40 transition-all group"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-base font-bold text-foreground truncate">{lead.full_name || 'לא צוין שם'}</p>
            <RepeatEnquiryBadge
              entry={repeatEntry}
              contactId={lead.contact_id}
              currentLeadId={lead.id}
              name={lead.full_name}
              phone={lead.phone}
            />
            {/* Status always has a badge. A lead with no status is a real
                state a rep needs to see, and a card that simply omits the
                badge reads as "I forgot to look" rather than "there is none". */}
            {lead.status
              ? <StatusBadge status={lead.status} />
              : <StatusBadge status="__none__" label="ללא סטטוס" />}
          </div>
          <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground flex-wrap">
            {lead.phone ? (
              <span className="inline-flex items-center gap-1" dir="ltr">
                <Phone className="h-3 w-3" />
                {formatPhone(lead.phone)}
              </span>
            ) : null}
            {lead.email ? <span className="truncate max-w-[200px]">{lead.email}</span> : null}
            {sourceLabel ? (
              <span className="inline-flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-indigo-400" />
                {sourceLabel}
              </span>
            ) : null}
          </div>
          {/* Date and hour on one line: the hour is a follow-up to the date,
              so it's smaller and lighter rather than a second date-sized fact. */}
          <div className="mt-1.5 text-[11px] text-muted-foreground inline-flex items-baseline gap-1.5 whitespace-nowrap">
            <Calendar className="h-3 w-3 self-center" />
            <span>נוצר:</span>
            {createdAt ? (
              <>
                <span className="font-medium text-foreground tabular-nums">
                  {formatInTimeZone(createdAt, 'Asia/Jerusalem', 'dd/MM/yyyy')}
                </span>
                <span className="text-[10px] text-muted-foreground/70 tabular-nums">
                  {formatInTimeZone(createdAt, 'Asia/Jerusalem', 'HH:mm')}
                </span>
              </>
            ) : (
              <span className="font-medium text-foreground">—</span>
            )}
          </div>
          {ownerEmail ? (
            <div className="mt-1 text-[11px] text-muted-foreground flex items-center gap-1">
              <Users className="h-3 w-3 flex-shrink-0" />
              {/* The email stays reachable in the tooltip — the admin fixing a
                  missing user record still needs to know which address it is. */}
              <span className="truncate" title={ownerEmail}>
                נציג מטפל: <span className="font-medium text-foreground">{ownerName}</span>
              </span>
              {lead.pending_rep_email && lead.rep1 ? (
                <span className="text-amber-700 flex-shrink-0">· ממתין לשיוך</span>
              ) : null}
            </div>
          ) : (
            <div className="mt-2 text-[11px] text-amber-700 inline-flex items-center gap-1">
              <Users className="h-3 w-3" />
              לא משויך לנציג
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {callHref ? (
            <a
              href={callHref}
              onClick={(e) => e.stopPropagation()}
              className="h-8 w-8 rounded-full bg-emerald-100 hover:bg-emerald-200 flex items-center justify-center transition-colors"
              title="התקשר"
              aria-label="התקשר"
            >
              <Phone className="h-4 w-4 text-emerald-700" />
            </a>
          ) : null}
          <ArrowLeft className="h-4 w-4 text-muted-foreground group-hover:text-primary group-hover:-translate-x-1 transition-all" aria-hidden="true" />
        </div>
      </div>
    </button>
  );
}
