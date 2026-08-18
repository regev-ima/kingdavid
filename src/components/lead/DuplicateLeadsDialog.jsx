import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import StatusBadge from '@/components/shared/StatusBadge';
import SourceBadge from '@/components/shared/SourceBadge';
import { format } from '@/lib/safe-date-fns';
import { parseDbTimestamp } from '@/lib/safe-date-fns-tz';
import { createPageUrl } from '@/utils';
import { formatIsraeliPhone } from '@/utils/phoneUtils';
import { getRepDisplayName } from '@/lib/repDisplay';
import { AlertTriangle, ArrowLeft, Loader2 } from 'lucide-react';

// One row per enquiry, one column per fact a rep needs to tell the enquiries
// apart: when it landed, how to reach them, which ad sent them, who owns it.
// Wide on purpose — the table scrolls sideways inside the dialog rather than
// dropping columns, because the whole point is seeing the records side by side.
const COLUMNS = [
  { key: 'name',     label: 'שם',          width: 'min-w-[140px]' },
  { key: 'created',  label: 'שעת כניסה',   width: 'min-w-[130px]' },
  { key: 'phone',    label: 'טלפון',       width: 'min-w-[120px]' },
  { key: 'email',    label: 'מייל',        width: 'min-w-[160px]' },
  { key: 'source',   label: 'מקור הגעה',   width: 'min-w-[130px]' },
  { key: 'landing',  label: 'דף נחיתה',    width: 'min-w-[160px]' },
  { key: 'campaign', label: 'שם קמפיין',   width: 'min-w-[160px]' },
  { key: 'clickId',  label: 'Click ID',    width: 'min-w-[120px]' },
  { key: 'rep',      label: 'נציג אחראי',  width: 'min-w-[130px]' },
  { key: 'status',   label: 'סטטוס',       width: 'min-w-[120px]' },
  { key: 'open',     label: '',            width: 'w-[76px]' },
];

const Cell = ({ value, className = '' }) => {
  const text = value == null || String(value).trim() === '' ? '' : String(value);
  return text ? (
    <span className={`block truncate ${className}`} title={text}>{text}</span>
  ) : (
    <span className="text-muted-foreground/50">—</span>
  );
};

/**
 * Every lead record of one person, in a table — what the "ליד כפול" badge
 * opens.
 *
 * A repeat enquiry deliberately becomes its own lead row (the daily count has
 * to match what Facebook and Google report), and the rows are tied together by
 * `contact_id`. Clicking the warning used to do what clicking anywhere else on
 * the row does — open that one lead — which answered the question the warning
 * raises ("which OTHER records exist?") with the record the rep was already
 * looking at. Now it lays all of them out with the fields that distinguish
 * them: two enquiries a month apart off two different campaigns look identical
 * until the campaign, the landing page and the owner are on screen together.
 *
 * The row the rep came from is marked and not linked — it is the page they are
 * on. Every other row opens that lead.
 */
export default function DuplicateLeadsDialog({ open, onOpenChange, contactId, currentLeadId, name }) {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['lead-duplicate-records', contactId],
    enabled: !!open && !!contactId,
    staleTime: 60_000,
    queryFn: async () => {
      const list = await base44.entities.Lead.filter({ contact_id: contactId });
      if (!Array.isArray(list)) return [];
      return list.slice().sort((a, b) => {
        // Newest first, matching the leads list and the enquiries card, so the
        // rep reads the three screens in one order.
        const da = parseDbTimestamp(a?.effective_sort_date || a?.created_date);
        const db = parseDbTimestamp(b?.effective_sort_date || b?.created_date);
        return (db?.getTime() || 0) - (da?.getTime() || 0);
      });
    },
  });

  // Shares the ['users'] key the rest of the app already loads, so rep1 turns
  // from an email into a name without a request of its own.
  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => base44.entities.User.list(),
    staleTime: 5 * 60_000,
    retry: false,
    enabled: !!open,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* The badge lives inside a clickable lead row, and a portal still
          bubbles clicks up the React tree — without this, closing the dialog
          navigates into the lead behind it. */}
      <DialogContent
        className="max-w-[min(1100px,95vw)] p-0 gap-0 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <DialogHeader className="px-5 py-4 border-b border-border text-start">
          <DialogTitle className="flex items-center gap-2 text-base font-bold">
            <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0" aria-hidden="true" />
            <span className="min-w-0 truncate">
              פניות כפולות{name ? ` — ${name}` : ''}
            </span>
            {rows.length > 0 ? (
              <span className="inline-flex items-center justify-center rounded-full px-1.5 min-w-[20px] h-5 text-[11px] font-bold bg-amber-100 text-amber-700">
                {rows.length}
              </span>
            ) : null}
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            טוען פניות…
          </div>
        ) : rows.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            לא נמצאו פניות נוספות מאותו לקוח.
          </p>
        ) : (
          <div className="max-h-[70vh] overflow-auto">
            <table className="w-full text-sm border-collapse">
              <thead className="sticky top-0 z-10 bg-muted/60 backdrop-blur">
                <tr>
                  {COLUMNS.map((col) => (
                    <th
                      key={col.key}
                      className={`${col.width} text-start font-medium text-[11px] text-muted-foreground whitespace-nowrap px-3 py-2 border-b border-border`}
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const when = parseDbTimestamp(row.effective_sort_date || row.created_date);
                  const isCurrent = row.id === currentLeadId;
                  return (
                    <tr
                      key={row.id}
                      className={`border-b border-border/50 last:border-b-0 ${isCurrent ? 'bg-amber-50/70' : 'hover:bg-muted/30'}`}
                    >
                      <td className="px-3 py-2 max-w-[220px]">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <Cell value={row.full_name} className="font-medium" />
                          {isCurrent ? (
                            <span className="flex-none rounded-md bg-amber-100 text-amber-700 text-[10px] font-medium px-1.5 py-0.5 whitespace-nowrap">
                              הפנייה הנוכחית
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap tabular-nums text-xs">
                        {when ? format(when, 'dd/MM/yyyy HH:mm') : <span className="text-muted-foreground/50">—</span>}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-xs" dir="ltr">
                        <Cell value={formatIsraeliPhone(row.phone)} />
                      </td>
                      <td className="px-3 py-2 max-w-[200px] text-xs" dir="ltr">
                        <Cell value={row.email} />
                      </td>
                      <td className="px-3 py-2">
                        <SourceBadge source={row.source} />
                      </td>
                      <td className="px-3 py-2 max-w-[220px] text-xs">
                        {row.landing_page ? (
                          <a
                            href={row.landing_page}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block truncate text-primary hover:underline"
                            title={row.landing_page}
                          >
                            {row.landing_page}
                          </a>
                        ) : (
                          <span className="text-muted-foreground/50">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 max-w-[220px] text-xs">
                        <Cell value={row.utm_campaign || row.facebook_campaign_name} />
                      </td>
                      <td className="px-3 py-2 max-w-[160px] text-xs" dir="ltr">
                        <Cell value={row.click_id} />
                      </td>
                      <td className="px-3 py-2 max-w-[180px] text-xs">
                        <Cell value={getRepDisplayName(row.rep1, users)} />
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge status={row.status} className="whitespace-nowrap" />
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {isCurrent ? (
                          <span className="text-muted-foreground/50">—</span>
                        ) : (
                          <Link
                            to={`${createPageUrl('LeadDetails')}?id=${row.id}`}
                            onClick={() => onOpenChange(false)}
                            className="inline-flex items-center gap-1 font-medium text-primary hover:text-primary/80 whitespace-nowrap"
                          >
                            פתח
                            <ArrowLeft className="h-3.5 w-3.5" />
                          </Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
