import { History } from 'lucide-react';

/**
 * Small "פנייה נוספת" chip for a lead whose contact has enquired before.
 *
 * `ordinal` is the enquiry number from `useRepeatEnquiries` (2 = the second
 * time this person came in). Renders nothing without one, so a first-time
 * enquiry carries no marker at all.
 */
export default function RepeatEnquiryBadge({ ordinal, className = '' }) {
  if (!ordinal) return null;
  return (
    <span
      title={`פנייה מספר ${ordinal} מאותו לקוח`}
      className={`inline-flex items-center gap-1 rounded-md bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200 text-[10px] font-medium px-1.5 py-0.5 flex-shrink-0 whitespace-nowrap ${className}`}
    >
      <History className="h-2.5 w-2.5" />
      פנייה נוספת
    </span>
  );
}
