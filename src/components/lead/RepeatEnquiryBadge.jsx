import { AlertTriangle } from 'lucide-react';

/**
 * "ליד כפול" — a warning beside the name of a lead whose contact has enquired
 * before, so a rep sees it in the list without opening anything.
 *
 * A warning triangle rather than a neutral chip: the reason to know is that
 * someone else may already be working this person, and calling them a second
 * time as though they were new is the mistake this is here to prevent.
 *
 * `ordinal` is the enquiry number from `useRepeatEnquiries` (2 = the second
 * time this person came in). Renders nothing without one, so a first-time
 * enquiry carries no marker at all.
 */
export default function RepeatEnquiryBadge({ ordinal, className = '' }) {
  if (!ordinal) return null;
  return (
    <span
      title={`ליד כפול — פנייה מספר ${ordinal} מאותו לקוח`}
      className={`inline-flex items-center gap-1 rounded-md bg-amber-50 text-amber-700 ring-1 ring-amber-300 text-[10px] font-medium px-1.5 py-0.5 flex-shrink-0 whitespace-nowrap ${className}`}
    >
      <AlertTriangle className="h-3 w-3" aria-hidden="true" />
      ליד כפול
    </span>
  );
}
