import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
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
  StickyNote,
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
import LeadContactLogCard from '@/components/lead/LeadContactLogCard';
import LeadWhatsAppChatButton from '@/components/whatsapp/LeadWhatsAppChatButton';
import { formatSourceLabel, ALL_TASK_TYPE_LABELS } from '@/constants/leadOptions';
import SourceBadge from '@/components/shared/SourceBadge';
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

// Every task this lead has: the most urgent open one in full — what to do, the
// notes under it, when it's due and who owns it, and the button that closes it
// — then any other open task as a compact row, then the ones already done.
//
// The done list is the part a rep used to have to take on faith. A task that
// closed vanished from the lead entirely, so "did anyone follow up on this?"
// had no answer on the screen where it is asked. They are dimmed and dated,
// clearly finished work rather than a queue.
function LeadTasksCard({ queue, tasks = [], salesReps, onOpenTask, onCompleteTask, onAddTask }) {
  const [first, ...rest] = queue;
  const task = first?.entity;

  // completed_at is stamped by a trigger the moment the task leaves the open
  // state; updated_date is the pre-trigger answer, kept for tasks closed before
  // that migration ran (where it holds the same moment anyway).
  const closedWhen = (t) => parseWorkbenchDate(t?.completed_at || t?.updated_date);

  const doneTasks = (tasks || [])
    .filter((t) => t?.task_status === 'completed')
    .sort((a, b) => (closedWhen(b)?.getTime() || 0) - (closedWhen(a)?.getTime() || 0));

  const doneList = doneTasks.length > 0 ? (
    <div className="px-4 pb-3 pt-2 border-t border-border/50">
      <span className="text-[11px] font-medium text-muted-foreground/80">
        בוצעו ({doneTasks.length})
      </span>
      <ul className="list-none m-0 p-0 mt-1 max-h-[132px] overflow-y-auto">
        {doneTasks.map((t) => {
          const closedAt = closedWhen(t);
          // Who actually closed it — not t.rep1, which is who it belonged to. A
          // manager closing a rep's task is the case this line exists for.
          // Blank for tasks closed before the stamp existed: no name beats the
          // wrong name.
          const closedBy = t.completed_by ? getRepDisplayName(t.completed_by, salesReps) : '';
          const title = String(t.summary || '').split('\n')[0]
            || ALL_TASK_TYPE_LABELS[t.task_type]
            || 'משימה';
          // The row has room for the day; the full time lives in the tooltip.
          const day = closedAt ? formatInTimeZone(closedAt, 'Asia/Jerusalem', 'dd/MM') : '';
          const exact = closedAt ? formatInTimeZone(closedAt, 'Asia/Jerusalem', 'dd/MM/yyyy HH:mm') : '';
          return (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => onOpenTask?.(t)}
                title={[title, closedBy && `בוצע ע״י ${closedBy}`, exact].filter(Boolean).join(' · ')}
                className="w-full flex items-center gap-2 px-2 py-1 -mx-2 rounded-lg text-start hover:bg-muted transition-colors"
              >
                <Check className="h-3.5 w-3.5 flex-shrink-0 text-emerald-600" />
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted-foreground">{title}</span>
                <span className="flex-none text-[11px] text-muted-foreground/70">
                  {closedBy ? <span className="truncate">{closedBy} · </span> : null}
                  <span className="tabular-nums">{day}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  ) : null;

  if (!task) {
    return (
      <section className="rounded-2xl border border-border bg-card shadow-card overflow-hidden">
        <div className="flex items-center justify-between gap-2 px-4 py-3">
          <span className="inline-flex items-center gap-2 text-sm font-bold">
            <ClipboardCheck className="h-4 w-4 text-primary" />
            משימות
          </span>
        </div>
        {/* Nothing to do is one line, not a panel. The empty state used to be
            a 150px tinted box for a sentence and a button, and three cards
            doing that at once pushed the lead's real content off-screen. */}
        <div className="px-4 pb-3 -mt-1 flex items-center justify-between gap-2">
          <span className="text-[13px] text-muted-foreground">אין משימות פתוחות לליד הזה.</span>
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1 bg-card flex-shrink-0" onClick={onAddTask}>
            <Plus className="h-3.5 w-3.5" />
            משימה חדשה
          </Button>
        </div>
        {doneList}
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
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <span className="inline-flex items-center gap-2 text-sm font-bold">
          <ClipboardCheck className="h-4 w-4 text-primary" />
          משימות
        </span>
        {overdue ? (
          <span className="inline-flex items-center rounded-md bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700 ring-1 ring-rose-200">
            באיחור
          </span>
        ) : null}
      </div>

      {/* One row: what to do, when and whose, and the button that closes it.
          This was a tinted panel with the title, the notes, a meta line and
          the button each on their own row — 280px to say one sentence. The
          notes ride in the row's tooltip and open in full with the task, which
          is one click away and where a rep goes to act on them anyway. */}
      <div className="px-4 pb-3 -mt-1">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onOpenTask?.(task)}
            title={notes ? `${title}\n\n${notes}` : title}
            className="min-w-0 flex-1 text-start rounded-lg px-2 py-1 -mx-2 hover:bg-muted transition-colors"
          >
            <span className="block text-[13.5px] font-bold truncate">{title}</span>
            {notes ? (
              <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground/90 min-w-0">
                <MessageSquare className="h-3 w-3 flex-shrink-0" />
                <span className="truncate">{notes}</span>
              </span>
            ) : null}
            <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground tabular-nums truncate">
              <CalendarDays className="h-3 w-3 flex-shrink-0" />
              {dueDate ? formatInTimeZone(dueDate, 'Asia/Jerusalem', 'dd/MM/yyyy') : 'ללא תאריך יעד'}
              {dueDate ? (
                <>
                  <Clock className="h-3 w-3 flex-shrink-0" />
                  {formatInTimeZone(dueDate, 'Asia/Jerusalem', 'HH:mm')}
                </>
              ) : null}
              {owner ? (
                <>
                  <span className="text-border" aria-hidden="true">|</span>
                  <span className="truncate">{owner}</span>
                </>
              ) : null}
            </span>
          </button>

          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 flex-shrink-0 border-emerald-200 bg-card text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
            onClick={() => onCompleteTask?.(task)}
          >
            <Check className="h-3.5 w-3.5" />
            סמן כבוצע
          </Button>
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
      {doneList}
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
  repeatEnquiry,
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
  onSaveNotes,
  children,
}) {
  const [copied, setCopied] = useState(false);

  // Free-text notes on the lead. They live under פרטי שיווק because that is
  // where the rep reads "who is this and where did they come from" — and what
  // they scribbled about the call belongs to the same question. Saved on its
  // own, so writing a note never depends on the edit mode being open.
  const [notesDraft, setNotesDraft] = useState(lead?.notes || '');
  const [notesSaving, setNotesSaving] = useState(false);
  // Follow the lead when it changes underneath (another screen, a refetch) —
  // but never while the rep has unsaved words in the box.
  useEffect(() => {
    setNotesDraft((draft) => (draft === '' || draft === lead?.notes ? (lead?.notes || '') : draft));
  }, [lead?.id, lead?.notes]);
  const notesDirty = (notesDraft || '') !== (lead?.notes || '');

  const saveNotes = async () => {
    if (!onSaveNotes || !notesDirty) return;
    setNotesSaving(true);
    try {
      await onSaveNotes(notesDraft);
    } finally {
      setNotesSaving(false);
    }
  };

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

  // utm_medium and utm_term are still stored on the lead, but they only matter
  // to whoever reads the marketing pages — a rep working the lead never acts on
  // "cpc" or a keyword, so they stay out of the card.
  const marketingRows = [
    { k: 'UTM Source', v: lead?.utm_source || sourceLabel },
    { k: 'UTM Campaign', v: lead?.utm_campaign || lead?.facebook_campaign_name },
    { k: 'UTM Content', v: lead?.utm_content || lead?.facebook_ad_name },
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
          <RepeatEnquiryBadge
            entry={repeatEnquiry}
            contactId={lead?.contact_id}
            currentLeadId={lead?.id}
            name={lead?.full_name}
            phone={lead?.phone}
          />
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
              <SourceBadge source={lead?.source} />
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
            the RIGHT — the side the mockup puts it on.

            The split is by height, not by topic: marketing carries the UTM
            rows and the notes box, so it alone is nearly as tall as the two
            history cards stacked. Pairing it with the next task on the right
            and putting the two histories on the left leaves the columns close
            enough in height that neither ends in a band of empty card. */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
          <div className="space-y-4">
            <section className="rounded-2xl border border-border bg-card shadow-card overflow-hidden">
              <div className="px-4 py-3">
                <span className="inline-flex items-center gap-2 text-sm font-bold">
                  <Target className="h-4 w-4 text-primary" />
                  פרטי שיווק
                </span>
              </div>
              {/* Reference values a rep glances at, not a table they read.
                  They were laid out like paragraphs — 44px a row — and pushed
                  the rest of the lead off the screen for it. */}
              <ul className="list-none m-0 px-4 pb-3">
                {marketingRows.map((row) => (
                  <li
                    key={row.k}
                    className="flex items-center justify-between gap-4 py-1.5 text-[13px] border-t first:border-t-0 border-border/50"
                  >
                    <span className="text-[12px] text-muted-foreground/70 flex-none">{row.k}</span>
                    <span className="min-w-0 truncate text-start" title={row.v || ''}>{row.v || '—'}</span>
                  </li>
                ))}
              </ul>

              <div className="px-4 pb-3 pt-1 border-t border-border/50">
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground/80">
                    <StickyNote className="h-3.5 w-3.5" />
                    הערות
                  </span>
                  {canEdit && notesDirty ? (
                    <Button
                      type="button"
                      size="sm"
                      className="h-7 text-xs gap-1.5"
                      disabled={notesSaving}
                      onClick={saveNotes}
                    >
                      {notesSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                      שמור
                    </Button>
                  ) : null}
                </div>
                {canEdit ? (
                  <Textarea
                    value={notesDraft}
                    onChange={(e) => setNotesDraft(e.target.value)}
                    // Clicking away saves, so a note is never lost to a closed
                    // popup. The button stays for the rep who wants to be told.
                    onBlur={saveNotes}
                    rows={2}
                    placeholder="מה חשוב לזכור על הליד הזה..."
                    className="resize-none text-[13px]"
                  />
                ) : (
                  <p className="text-sm whitespace-pre-wrap text-foreground/90">
                    {lead?.notes || <span className="text-muted-foreground/70">—</span>}
                  </p>
                )}
              </div>
            </section>

          </div>

          {/* What was said to this person, and what is still owed to them.
              The previous enquiries used to sit here too; they moved into the
              "ליד כפול" badge, which opens all of the person's records with
              the fields that tell them apart — a table this column had no room
              for and a question this column answered with three dates. */}
          <div className="space-y-4">
            <LeadContactLogCard
              lead={lead}
              users={users}
              onAddCommunication={onAddCommunication}
            />

            <LeadTasksCard
              queue={queue}
              tasks={tasks}
              salesReps={salesReps}
              onOpenTask={onOpenTask}
              onCompleteTask={onCompleteTask}
              onAddTask={onAddTask}
            />
          </div>
        </div>

        {/* Activity — the collapsed track: three most recent events, "הצג
            הכל" swaps in the full vertical feed. */}
        <LeadUnifiedTimeline
          collapsible
          className="max-h-[560px]"
          leadId={lead?.id}
          lead={lead}
          tasks={tasks}
          users={users}
          onOpenTask={onOpenTask}
        />

        {children}
      </div>
    </div>
  );
}
