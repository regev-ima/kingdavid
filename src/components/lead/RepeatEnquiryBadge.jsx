import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import DuplicateLeadsDialog from '@/components/lead/DuplicateLeadsDialog';

/**
 * "ליד כפול" — a warning beside the name of a lead whose contact is in the
 * system more than once, so a rep sees it in the list without opening anything.
 *
 * A warning triangle rather than a neutral chip: the reason to know is that
 * someone else may already be working this person, and calling them a second
 * time as though they were new is the mistake this is here to prevent.
 *
 * `entry` is `{ ordinal, total }` from `useRepeatEnquiries` — which enquiry
 * this row is, and how many that person has. It sits on EVERY row of the
 * person, first included: a warning that only one of two identical rows carries
 * is a warning the rep can walk straight past. Renders nothing without an
 * entry, so a one-and-only enquiry carries no marker at all.
 *
 * With `contactId` it also answers itself: clicking opens every record of that
 * person in one table (`DuplicateLeadsDialog`). Without it the badge is inert
 * text, as it was — the click stops at the badge either way, so it never falls
 * through to the row underneath and opens the one lead the rep already has.
 */
export default function RepeatEnquiryBadge({ entry, contactId, currentLeadId, name, className = '' }) {
  const [open, setOpen] = useState(false);
  if (!entry) return null;

  const { ordinal, total } = entry;
  const base = total
    ? `ליד כפול — פנייה ${ordinal} מתוך ${total} מאותו לקוח`
    : `ליד כפול — פנייה מספר ${ordinal} מאותו לקוח`;
  const title = contactId ? `${base}. לחצו לצפייה בכל הפניות` : base;

  const badge = (
    <span
      title={title}
      // role/tabIndex instead of a real <button>: the badge is rendered inside
      // rows that are themselves buttons in some lists, and a button in a
      // button is invalid markup.
      {...(contactId
        ? {
          role: 'button',
          tabIndex: 0,
          onClick: (e) => { e.preventDefault(); e.stopPropagation(); setOpen(true); },
          onKeyDown: (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            e.stopPropagation();
            setOpen(true);
          },
        }
        : {})}
      className={`inline-flex items-center gap-1 rounded-md bg-amber-50 text-amber-700 ring-1 ring-amber-300 text-[10px] font-medium px-1.5 py-0.5 flex-shrink-0 whitespace-nowrap ${contactId ? 'cursor-pointer hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-400' : ''} ${className}`}
    >
      <AlertTriangle className="h-3 w-3" aria-hidden="true" />
      ליד כפול
    </span>
  );

  if (!contactId) return badge;

  return (
    <>
      {badge}
      <DuplicateLeadsDialog
        open={open}
        onOpenChange={setOpen}
        contactId={contactId}
        currentLeadId={currentLeadId}
        name={name}
      />
    </>
  );
}
