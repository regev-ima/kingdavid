import { AlertTriangle } from 'lucide-react';

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
 */
export default function RepeatEnquiryBadge({ entry, className = '' }) {
  if (!entry) return null;
  const { ordinal, total } = entry;
  const title = total
    ? `ליד כפול — פנייה ${ordinal} מתוך ${total} מאותו לקוח`
    : `ליד כפול — פנייה מספר ${ordinal} מאותו לקוח`;
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-md bg-amber-50 text-amber-700 ring-1 ring-amber-300 text-[10px] font-medium px-1.5 py-0.5 flex-shrink-0 whitespace-nowrap ${className}`}
    >
      <AlertTriangle className="h-3 w-3" aria-hidden="true" />
      ליד כפול
    </span>
  );
}
