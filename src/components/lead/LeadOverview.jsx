import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  Check,
  ChevronDown,
  ClipboardCheck,
  Clock,
  Copy,
  Crown,
  FileText,
  Globe,
  Loader2,
  MessageCircle,
  MessageSquare,
  MoreVertical,
  Pencil,
  Phone,
  Plus,
  Save,
  Target,
  User,
  UserMinus,
} from 'lucide-react';
import StatusBadge from '@/components/shared/StatusBadge';
import SLABadge from '@/components/sla/SLABadge';
import RepeatEnquiryBadge from '@/components/lead/RepeatEnquiryBadge';
import LeadUnifiedTimeline from '@/components/lead/LeadUnifiedTimeline';
import LeadWhatsAppChatButton from '@/components/whatsapp/LeadWhatsAppChatButton';
import { formatSourceLabel, ALL_TASK_TYPE_LABELS } from '@/constants/leadOptions';
import { getRepDisplayName } from '@/lib/repDisplay';
import { parseWorkbenchDate } from '@/lib/leadWorkbench';
import { formatInTimeZone } from '@/lib/safe-date-fns-tz';

/**
 * The lead popup's overview — v6.
 *
 * Everything a rep reads before they act, in the order the approved mockup
 * (design-previews/lead-modal-v6-strip.html) puts it: who the lead is, the
 * five facts about them, the six things you can do, the next task, where the
 * lead came from, and the recent activity as a horizontal track.
 *
 * Presentation only. Every query, mutation and dialog stays in LeadDetails —
 * this component receives data and callbacks, which is what lets it be read,
 * parsed and reasoned about on its own instead of as another 300 lines inside
 * a 1,700-line page.
 *
 * `children` render inside the scrollable body, below the overview: the parts
 * of the lead screen the v6 design doesn't cover (customer details, quotes,
 * service, other enquiries). In modal mode the header is a flex-shrink-0
 * sibling of that scroll area, so it never moves — the same fixed-header
 * arrangement the popup had before this layout.
 */

// Divider on the START side of every cell but the first — in RTL that is the
// cell's right edge, i.e. BETWEEN it and the cell before it. Using `end`
// instead draws a stray rule on the strip's outer left edge and leaves
// סטטוס/מקור הגעה with no divider at all.
const FACT_CELL = 'px-3 py-3.5 text-center min-w-0 [&+&]:border-s [&+&]:border-border/60';

function factDate(value) {
  if (!value) return '';
  try {
    return formatInTimeZone(value, 'Asia/Jerusalem', 'dd/MM/yyyy HH:mm');
  } catch {
    return '';
  }
}

// One rep slot as a facts-strip cell: the name reads as plain text, and for
// whoever may change it the same cell is a menu — swap the rep, clear the
// slot, or reach them directly. RepCard covers this for the old left-aligned
// essentials bar; the strip's cells are centred and label-above-value, so the
// slot is laid out here and only the behaviour is shared.
function RepFact({ label, email, salesReps, canEdit, isPending, excludeEmails = [], onAssign, onRemove }) {
  const rep = email
    ? (salesReps.find((r) => r?.email === email) || { email, full_name: getRepDisplayName(email, salesReps) })
    : null;
  const name = rep ? (rep.full_name || rep.email) : '';
  const assignable = salesReps.filter(
    (r) => r?.email && r.email !== email && !excludeEmails.some((x) => x && r.email === x),
  );

  const value = (
    <span className="inline-flex items-center gap-1.5 min-w-0 max-w-full">
      <User className="h-3.5 w-3.5 text-muted-foreground/60 flex-shrink-0" />
      <span className={`truncate ${rep ? '' : 'text-muted-foreground/70'}`}>{name || 'לא משויך'}</span>
    </span>
  );

  if (!canEdit || (assignable.length === 0 && !rep)) {
    return (
      <div className={FACT_CELL}>
        <dt className="text-xs text-muted-foreground/70 mb-1.5">{label}</dt>
        <dd className="m-0 text-sm font-medium flex items-center justify-center min-w-0">{value}</dd>
      </div>
    );
  }

  return (
    <div className={FACT_CELL}>
      <dt className="text-xs text-muted-foreground/70 mb-1.5">{label}</dt>
      <dd className="m-0 text-sm font-medium flex items-center justify-center min-w-0">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              disabled={isPending}
              className="inline-flex items-center gap-1 min-w-0 max-w-full rounded-md px-1.5 py-0.5 -my-0.5 hover:bg-muted transition-colors disabled:opacity-60"
              title={rep ? `${label}: ${name}` : `שייך ${label}`}
            >
              {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin flex-shrink-0" /> : value}
              <ChevronDown className="h-3 w-3 text-muted-foreground/50 flex-shrink-0" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" dir="rtl" className="max-h-72 overflow-y-auto">
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              {rep ? `החלף ${label}` : `שייך ${label}`}
            </DropdownMenuLabel>
            {assignable.map((r) => (
              <DropdownMenuItem key={r.email} onClick={() => onAssign?.(r.email)}>
                {r.full_name || r.email}
              </DropdownMenuItem>
            ))}
            {assignable.length === 0 ? (
              <DropdownMenuItem disabled>אין נציג נוסף לשיוך</DropdownMenuItem>
            ) : null}
            {rep && onRemove ? (
              <>
                <DropdownMenuSeparator />
                {rep.phone ? (
                  <DropdownMenuItem onClick={() => window.open(`tel:${rep.phone}`, '_self')}>
                    <Phone className="h-3.5 w-3.5 me-2" />
                    התקשר ל{name}
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem onClick={onRemove}>
                  <UserMinus className="h-3.5 w-3.5 me-2" />
                  הסר שיוך
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </dd>
    </div>
  );
}

// The lead's most urgent open task, rendered the way the mockup does: what to
// do, the notes under it, when it's due and who owns it, and the one button
// that closes it. Any other open task follows as a compact row — the queue
// this card replaced showed all of them, and a rep with three open tasks still
// needs to see that there are three.
function NextTaskCard({ queue, salesReps, onOpenTask, onCompleteTask, onAddTask }) {
  const [first, ...rest] = queue;
  const task = first?.entity;

  if (!task) {
    return (
      <section className="rounded-2xl border border-border bg-card shadow-card overflow-hidden">
        <div className="flex items-center justify-between gap-2 px-4 py-3.5">
          <span className="inline-flex items-center gap-2 text-sm font-bold">
            <ClipboardCheck className="h-4 w-4 text-primary" />
            משימה הבאה
          </span>
        </div>
        <div className="px-4 pb-4">
          <div className="rounded-xl bg-muted/50 px-4 py-5 text-center">
            <p className="text-sm text-muted-foreground">אין משימות פתוחות לליד הזה.</p>
            <Button variant="outline" size="sm" className="mt-3 h-8 gap-1.5 bg-card" onClick={onAddTask}>
              <Plus className="h-3.5 w-3.5" />
              משימה חדשה
            </Button>
          </div>
        </div>
      </section>
    );
  }

  const dueDate = parseWorkbenchDate(task.due_date);
  const summary = String(task.summary || '').trim();
  const [headline, ...noteLines] = summary.split('\n');
  const notes = noteLines.join('\n').trim();
  const title = headline || ALL_TASK_TYPE_LABELS[task.task_type] || 'משימה פתוחה';
  const owner = getRepDisplayName(task.rep1, salesReps);
  const overdue = first.type === 'task_overdue';

  return (
    <section className="rounded-2xl border border-border bg-card shadow-card overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 py-3.5">
        <span className="inline-flex items-center gap-2 text-sm font-bold">
          <ClipboardCheck className="h-4 w-4 text-primary" />
          משימה הבאה
        </span>
        {overdue ? (
          <span className="inline-flex items-center rounded-md bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700 ring-1 ring-rose-200">
            באיחור
          </span>
        ) : null}
      </div>

      <div className="px-4 pb-4">
        <div
          role="button"
          tabIndex={0}
          onClick={() => onOpenTask?.(task)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onOpenTask?.(task);
            }
          }}
          className="rounded-xl bg-muted/50 p-4 cursor-pointer transition-colors hover:bg-muted"
        >
          <div className="flex items-start justify-between gap-2">
            <h4 className="m-0 text-[15px] font-bold min-w-0">{title}</h4>
            {notes ? (
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground/70 flex-shrink-0">
                <MessageSquare className="h-3.5 w-3.5" />
                הערות
              </span>
            ) : null}
          </div>

          {notes ? (
            <p className="mt-2 mb-0 text-[13.5px] leading-relaxed text-muted-foreground whitespace-pre-wrap">{notes}</p>
          ) : null}

          <div className="mt-4 flex items-center gap-2.5 flex-wrap text-[13px] text-muted-foreground tabular-nums">
            {dueDate ? (
              <>
                <span className="inline-flex items-center gap-1.5">
                  <CalendarDays className="h-3.5 w-3.5" />
                  {formatInTimeZone(dueDate, 'Asia/Jerusalem', 'dd/MM/yyyy')}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5" />
                  {formatInTimeZone(dueDate, 'Asia/Jerusalem', 'HH:mm')}
                </span>
              </>
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays className="h-3.5 w-3.5" />
                ללא תאריך יעד
              </span>
            )}
            {owner ? (
              <>
                <span className="text-border" aria-hidden="true">|</span>
                <span>{owner}</span>
              </>
            ) : null}
          </div>

          <div className="mt-4 flex">
            <Button
              variant="outline"
              size="sm"
              className="ms-auto h-9 gap-2 border-emerald-200 bg-card text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
              onClick={(e) => {
                e.stopPropagation();
                onCompleteTask?.(task);
              }}
            >
              <Check className="h-3.5 w-3.5" />
              סמן כבוצע
            </Button>
          </div>
        </div>

        {rest.length > 0 ? (
          <ul className="mt-2 divide-y divide-border/40 rounded-xl border border-border/60">
            {rest.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onOpenTask?.(item.entity)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-start hover:bg-muted/60 transition-colors"
                >
                  <ClipboardCheck className="h-3.5 w-3.5 text-muted-foreground/60 flex-shrink-0" />
                  <span className="text-[13px] truncate min-w-0 flex-1">
                    {String(item.entity?.summary || '').split('\n')[0] || item.title}
                  </span>
                  <span className="text-[11px] text-muted-foreground tabular-nums flex-shrink-0">
                    {parseWorkbenchDate(item.dueAt)
                      ? formatInTimeZone(parseWorkbenchDate(item.dueAt), 'Asia/Jerusalem', 'dd/MM')
                      : 'ללא יעד'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}

export default function LeadOverview({
  lead,
  tasks = [],
  users = [],
  salesReps = [],
  queue = [],
  isModal = false,
  isEditing = false,
  isSaving = false,
  canEdit = false,
  canEditRep1 = false,
  canEditRep2 = false,
  repeatEnquiryOrdinal,
  openServiceTicketsCount = 0,
  leadAge = '',
  onBack,
  onCall,
  onOpenStatusTask,
  onAssignRep1,
  onAssignRep2,
  onRemoveRep,
  onToggleEdit,
  onAddTask,
  onNewQuote,
  onNewOrder,
  onAddCommunication,
  onConvertToCustomer,
  canConvertToCustomer = false,
  onOpenTask,
  onCompleteTask,
  onOpenServiceSection,
  children,
}) {
  const [copied, setCopied] = useState(false);

  const sourceLabel = formatSourceLabel(lead?.source);
  // The specific ad that produced the enquiry. Not every integration fills
  // facebook_ad_name, so it falls down the chain to whatever names the source
  // best. It rides under מקור הגעה because "where did he come from?" is one
  // question, not two.
  const adLabel = lead?.facebook_ad_name
    || lead?.facebook_campaign_name
    || lead?.utm_campaign
    || lead?.facebook_adset_name
    || lead?.source_form
    || '';

  const marketingRows = [
    { k: 'UTM Source', v: lead?.utm_source || sourceLabel },
    { k: 'UTM Medium', v: lead?.utm_medium },
    { k: 'UTM Campaign', v: lead?.utm_campaign || lead?.facebook_campaign_name },
    { k: 'UTM Content', v: lead?.utm_content || lead?.facebook_ad_name },
    { k: 'UTM Term', v: lead?.utm_term || lead?.facebook_adset_name },
  ];

  const copyPhone = async () => {
    if (!lead?.phone) return;
    try {
      await navigator.clipboard.writeText(lead.phone);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard blocked (insecure context / denied permission) — the number
      // is right there to read, so there is nothing to report.
    }
  };

  return (
    <div className={isModal ? 'flex flex-col min-h-0 overflow-hidden' : 'space-y-4'}>
      {/* Header — identity and the two controls that act on the lead record
          itself. In popup mode it's flex-shrink-0 so it never scrolls; pe-16
          clears the dialog's own close-X, which sits at the inline-end edge. */}
      <div
        className={
          'flex items-center gap-3 flex-wrap'
          + (isModal ? ' flex-shrink-0 px-5 py-3.5 pe-16 bg-card border-b border-border' : '')
        }
      >
        <Button variant="outline" size="icon" className="h-10 w-10 rounded-lg flex-shrink-0" onClick={onBack} title="חזרה">
          <ArrowRight className="h-4 w-4" />
        </Button>

        <span className="h-11 w-11 rounded-full bg-primary/10 text-primary grid place-items-center text-lg font-bold flex-shrink-0">
          {String(lead?.full_name || '?').trim().charAt(0)}
        </span>

        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <h1 className="text-2xl font-extrabold tracking-tight m-0 truncate">{lead?.full_name}</h1>
          <SLABadge lead={lead} />
          <RepeatEnquiryBadge ordinal={repeatEnquiryOrdinal} />
        </div>

        {/* The phone sits mid-header and the edit/kebab pair holds the far
            end — two auto margins, so the gap opens on BOTH sides of the
            number instead of parking it against the edit button. */}
        {lead?.phone ? (
          <span className="ms-auto inline-flex items-center gap-2 text-[15px] tabular-nums">
            <button
              type="button"
              onClick={copyPhone}
              className="h-6 w-6 grid place-items-center rounded-md text-muted-foreground/60 hover:bg-muted hover:text-foreground transition-colors"
              title="העתק מספר"
              aria-label="העתק מספר"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
            <span dir="ltr">{lead.phone}</span>
          </span>
        ) : null}

        <span className="ms-auto flex items-center gap-2 flex-shrink-0">
          {openServiceTicketsCount > 0 ? (
            <button
              type="button"
              onClick={onOpenServiceSection}
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100 transition-colors"
              title="עבור לאזור פניות השירות"
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              {openServiceTicketsCount === 1 ? 'קריאת שירות פתוחה' : `${openServiceTicketsCount} קריאות שירות`}
            </button>
          ) : null}

          {canEdit ? (
            <Button
              variant={isEditing ? 'default' : 'outline'}
              className="h-10 rounded-lg gap-2"
              onClick={onToggleEdit}
              disabled={isSaving}
            >
              {isSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : isEditing ? (
                <>
                  <Save className="h-4 w-4" />
                  שמור
                </>
              ) : (
                <>
                  <Pencil className="h-4 w-4 text-primary" />
                  ערוך ליד
                </>
              )}
            </Button>
          ) : null}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" className="h-10 w-10 rounded-lg" title="עוד">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" dir="rtl">
              {canConvertToCustomer ? (
                <DropdownMenuItem onClick={onConvertToCustomer}>
                  <Crown className="h-3.5 w-3.5 me-2" />
                  המר ללקוח
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem disabled>אין פעולות נוספות</DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      </div>

      {/* Body — in popup mode this is the only thing that scrolls. */}
      <div className={isModal ? 'flex-auto min-h-0 overflow-y-auto p-4 lg:px-5 lg:py-4 space-y-4' : 'space-y-4'}>
        {/* Facts strip — the five things you check before you dial. */}
        <dl className="m-0 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 rounded-2xl border border-border bg-card shadow-card overflow-hidden">
          <div className={FACT_CELL}>
            <dt className="text-xs text-muted-foreground/70 mb-1.5">סטטוס</dt>
            <dd className="m-0 flex items-center justify-center min-w-0">
              {canEdit ? (
                // The status is changed through a task — that's where the
                // no-answer / follow-up scheduling lives — so the cell opens
                // the lead's latest task rather than editing the value.
                <button
                  type="button"
                  onClick={onOpenStatusTask}
                  title="הסטטוס משתנה דרך משימה — לחץ לפתיחת המשימה האחרונה"
                  className="max-w-full rounded-md px-1 py-0.5 -my-0.5 hover:bg-muted transition-colors"
                >
                  <StatusBadge status={lead?.status} />
                </button>
              ) : (
                <StatusBadge status={lead?.status} />
              )}
            </dd>
          </div>

          <div className={FACT_CELL}>
            <dt className="text-xs text-muted-foreground/70 mb-1.5">מקור הגעה</dt>
            <dd className="m-0 text-sm font-medium flex items-center justify-center gap-1.5 min-w-0">
              <Globe className="h-3.5 w-3.5 text-muted-foreground/60 flex-shrink-0" />
              <span className="truncate">{sourceLabel || '—'}</span>
            </dd>
            {adLabel ? (
              <p className="m-0 mt-1 text-[11px] text-muted-foreground/70 truncate" title={`מודעה: ${adLabel}`}>
                {adLabel}
              </p>
            ) : null}
          </div>

          <div className={FACT_CELL} title={lead?.updated_date ? `עדכון אחרון: ${factDate(lead.updated_date)}` : undefined}>
            <dt className="text-xs text-muted-foreground/70 mb-1.5">תאריך כניסה</dt>
            <dd className="m-0 text-sm font-medium flex items-center justify-center gap-1.5 min-w-0">
              <CalendarDays className="h-3.5 w-3.5 text-muted-foreground/60 flex-shrink-0" />
              <span className="truncate tabular-nums">{factDate(lead?.created_date) || '—'}</span>
            </dd>
            {leadAge ? <p className="m-0 mt-1 text-[11px] text-muted-foreground/70 truncate">גיל הליד: {leadAge}</p> : null}
          </div>

          <RepFact
            label="נציג אחראי"
            email={lead?.rep1}
            salesReps={salesReps}
            canEdit={canEditRep1}
            isPending={isSaving}
            onAssign={onAssignRep1}
            onRemove={lead?.rep1 ? () => onRemoveRep?.('rep1') : undefined}
          />

          <RepFact
            label="נציג שני"
            email={lead?.rep2}
            salesReps={salesReps}
            canEdit={canEditRep2}
            isPending={isSaving}
            excludeEmails={[lead?.rep1]}
            onAssign={onAssignRep2}
            onRemove={lead?.rep2 ? () => onRemoveRep?.('rep2') : undefined}
          />
        </dl>

        {/* Actions — six equal columns filling the width, the way the
            reference lays them out, not a right-bunched row with dead space
            on the left. Two per row on phones. */}
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-2.5">
          <Button
            className="h-11 rounded-xl justify-center gap-2"
            onClick={() => onCall?.(lead?.phone)}
            disabled={!lead?.phone}
          >
            <Phone className="h-4 w-4" />
            חיוג
          </Button>

          <LeadWhatsAppChatButton
            phone={lead?.phone}
            name={lead?.full_name}
            className="h-11 w-full rounded-xl justify-center text-sm"
          />

          <Button variant="outline" className="h-11 rounded-xl justify-center gap-2" onClick={onAddTask}>
            <ClipboardCheck className="h-4 w-4 text-primary" />
            משימה חדשה
          </Button>

          <Button variant="outline" className="h-11 rounded-xl justify-center gap-2" onClick={onNewQuote}>
            <FileText className="h-4 w-4 text-primary" />
            הצעה חדשה
          </Button>

          <Button variant="outline" className="h-11 rounded-xl justify-center gap-2" onClick={onNewOrder}>
            <CalendarDays className="h-4 w-4 text-primary" />
            הזמנה חדשה
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="h-11 rounded-xl justify-center gap-2">
                עוד פעולות
                <ChevronDown className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" dir="rtl">
              <DropdownMenuItem onClick={onAddCommunication}>
                <MessageCircle className="h-3.5 w-3.5 me-2" />
                הוסף תקשורת
              </DropdownMenuItem>
              {openServiceTicketsCount > 0 ? (
                <DropdownMenuItem onClick={onOpenServiceSection}>
                  <AlertTriangle className="h-3.5 w-3.5 me-2" />
                  קריאות שירות פתוחות
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Two columns. Marketing is first in the DOM, so in RTL it lands on
            the RIGHT — the side the mockup puts it on. */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
          <section className="rounded-2xl border border-border bg-card shadow-card overflow-hidden">
            <div className="px-4 py-3.5">
              <span className="inline-flex items-center gap-2 text-sm font-bold">
                <Target className="h-4 w-4 text-primary" />
                פרטי שיווק
              </span>
            </div>
            <ul className="list-none m-0 px-4 pb-4">
              {marketingRows.map((row) => (
                <li
                  key={row.k}
                  className="flex items-center justify-between gap-4 py-3 text-sm border-t first:border-t-0 border-border/50"
                >
                  <span className="text-[13px] text-muted-foreground/70 flex-none">{row.k}</span>
                  <span className="min-w-0 truncate text-start" title={row.v || ''}>{row.v || '—'}</span>
                </li>
              ))}
            </ul>
          </section>

          <NextTaskCard
            queue={queue}
            salesReps={salesReps}
            onOpenTask={onOpenTask}
            onCompleteTask={onCompleteTask}
            onAddTask={onAddTask}
          />
        </div>

        {/* Activity — the collapsed track: three most recent events, "הצג
            הכל" swaps in the full vertical feed. */}
        <LeadUnifiedTimeline
          collapsible
          className="max-h-[560px]"
          leadId={lead?.id}
          tasks={tasks}
          users={users}
          onOpenTask={onOpenTask}
        />

        {children}
      </div>
    </div>
  );
}
