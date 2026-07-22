import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import {
  UserPlus,
  RefreshCw,
  FileText,
  Edit3,
  CheckCircle,
  PlusCircle,
  Crown,
  MessageCircle,
  Clock,
  XCircle,
  Ban,
  Phone,
  CalendarDays,
  ShoppingBag,
  User,
  Tag,
  Activity,
  Mail,
} from 'lucide-react';
import { formatInTimeZone } from '@/lib/safe-date-fns-tz';
import { getRepDisplayName } from '@/lib/repDisplay';
import StatusBadge from '@/components/shared/StatusBadge';
import { ALL_TASK_TYPE_LABELS, LEAD_STATUS_OPTIONS } from '@/constants/leadOptions';

// ── shared text helpers (kept identical to the old LeadActivityTimeline so
// historical entries read exactly the same) ───────────────────────────────
const EMAIL_REGEX = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
function humanizeEmails(text, users) {
  if (text == null) return text;
  return String(text).replace(EMAIL_REGEX, (email) => getRepDisplayName(email, users) || email);
}

// Status changes are logged with the raw status *key* (e.g. "no_answer_1")
// in both the description and the old/new diff. Map every known key to its
// Hebrew label at render time so the feed never surfaces English keys — this
// also fixes every historical entry without a data migration.
const STATUS_LABELS = Object.fromEntries(LEAD_STATUS_OPTIONS.map((s) => [s.value, s.label]));
const STATUS_KEYS_RE = new RegExp(
  '\\b(' + LEAD_STATUS_OPTIONS.map((s) => s.value).sort((a, b) => b.length - a.length).join('|') + ')\\b',
  'g'
);
function humanizeStatuses(text) {
  if (text == null) return text;
  return String(text).replace(STATUS_KEYS_RE, (key) => STATUS_LABELS[key] || key);
}
// Map a single logged value (status key and/or rep email) to a human label.
function humanizeValue(value, users) {
  return humanizeStatuses(humanizeEmails(value, users));
}

// Log descriptions are "old → new"; inside RTL the arrow points the wrong way,
// so flip → to ← (the same direction the diff badge uses).
function formatDescription(text, users) {
  if (text == null) return text;
  return humanizeStatuses(humanizeEmails(text, users)).replace(/→/g, '←');
}

// ── change-event (activity-log) visual metadata ───────────────────────────
const actionIcons = {
  created: PlusCircle,
  status_changed: RefreshCw,
  rep_assigned: UserPlus,
  rep_changed: RefreshCw,
  field_updated: Edit3,
  task_created: Clock,
  task_completed: CheckCircle,
  note_added: MessageCircle,
  quote_created: FileText,
  converted_to_customer: Crown,
};
const actionColors = {
  created: 'bg-green-100 text-green-700',
  status_changed: 'bg-blue-100 text-blue-700',
  rep_assigned: 'bg-violet-100 text-violet-700',
  rep_changed: 'bg-amber-100 text-amber-700',
  field_updated: 'bg-muted text-foreground/80',
  task_created: 'bg-primary/10 text-primary',
  task_completed: 'bg-emerald-100 text-emerald-700',
  note_added: 'bg-sky-100 text-sky-700',
  quote_created: 'bg-purple-100 text-purple-700',
  converted_to_customer: 'bg-yellow-100 text-yellow-700',
};
const actionLabels = {
  created: 'נוצר',
  status_changed: 'סטטוס',
  rep_assigned: 'שיוך',
  rep_changed: 'שינוי נציג',
  field_updated: 'עדכון',
  task_created: 'משימה',
  task_completed: 'הושלם',
  note_added: 'הערה',
  quote_created: 'הצעה',
  converted_to_customer: 'המרה',
};

// ── task-event visual metadata (mirrors the old task-history card) ─────────
const TASK_TYPE_CHIP = {
  call:              { icon: Phone,        tone: 'bg-blue-100 text-blue-700' },
  meeting:           { icon: CalendarDays, tone: 'bg-amber-100 text-amber-700' },
  quote_preparation: { icon: FileText,     tone: 'bg-indigo-100 text-indigo-700' },
  close_order:       { icon: ShoppingBag,  tone: 'bg-emerald-100 text-emerald-700' },
  assignment:        { icon: User,         tone: 'bg-slate-100 text-slate-700' },
  followup:          { icon: Clock,        tone: 'bg-violet-100 text-violet-700' },
};
const FALLBACK_TASK_TYPE_CHIP = { icon: Tag, tone: 'bg-muted text-foreground/70' };

// Outcome of a closed task → the coloured dot + the small status pill.
const TASK_OUTCOME = {
  completed: { icon: CheckCircle, dot: 'bg-emerald-100 text-emerald-700', pill: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200', label: 'בוצע' },
  not_done:  { icon: XCircle,     dot: 'bg-red-100 text-red-700',         pill: 'bg-red-50 text-red-700 ring-1 ring-red-200',          label: 'לא בוצע' },
  cancelled: { icon: Ban,         dot: 'bg-muted text-muted-foreground',  pill: 'bg-muted text-muted-foreground ring-1 ring-border',    label: 'בוטל' },
};

// ── communication-event visual metadata (logged via "הוסף תקשורת") ─────────
const COMM_TYPE = {
  call:     { icon: Phone,         label: 'שיחה',    tone: 'bg-blue-100 text-blue-700' },
  whatsapp: { icon: MessageCircle, label: 'וואטסאפ', tone: 'bg-green-100 text-green-700' },
  email:    { icon: Mail,          label: 'אימייל',  tone: 'bg-purple-100 text-purple-700' },
  meeting:  { icon: CalendarDays,  label: 'פגישה',   tone: 'bg-amber-100 text-amber-700' },
};
const COMM_OUTCOME_LABELS = {
  answered_positive: 'נענה - חיובי',
  answered_neutral: 'נענה - ניטרלי',
  answered_negative: 'נענה - שלילי',
  no_answer: 'לא נענה',
  voicemail: 'הותיר הודעה',
  sent: 'נשלח',
};

const FILTERS = [
  { key: 'all', label: 'הכל' },
  { key: 'communication', label: 'תקשורת' },
  { key: 'task', label: 'משימות' },
  { key: 'change', label: 'שינויים' },
];

/**
 * One chronological feed that merges the lead's activity log (status changes,
 * rep assignments, quote creation, field edits…) with its closed tasks
 * (done / not-done / cancelled). Replaces the old separate "task history" and
 * "activity log" blocks. Self-contained: fetches the activity log itself and
 * takes the lead's tasks + users as props (the lead screen already loads both).
 */
export default function LeadUnifiedTimeline({ leadId, tasks = [], users = [], onOpenTask }) {
  const [filter, setFilter] = useState('all');

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ['leadActivityLogs', leadId],
    queryFn: () => base44.entities.LeadActivityLog.filter({ lead_id: leadId }),
    enabled: !!leadId,
    staleTime: 60000,
  });

  // Manually-logged communications ("הוסף תקשורת"). Same key AddCommunication
  // invalidates, so a freshly-added entry shows up here immediately.
  const { data: comms = [] } = useQuery({
    queryKey: ['communications', leadId],
    queryFn: () => base44.entities.CommunicationLog.filter({ lead_id: leadId }),
    enabled: !!leadId,
    staleTime: 60000,
  });

  // Closed tasks (anything that's no longer "not_completed") become entries.
  const closedTasks = useMemo(
    () => tasks.filter((t) => String(t?.task_status || '').toLowerCase() !== 'not_completed'),
    [tasks]
  );

  const events = useMemo(() => {
    const out = [];
    for (const log of logs) {
      out.push({
        id: `log-${log.id}`,
        kind: 'change',
        ts: new Date(log.created_date || 0).getTime() || 0,
        log,
      });
    }
    for (const task of closedTasks) {
      const ts = task.updated_date
        ? new Date(task.updated_date).getTime()
        : new Date(task.created_date || 0).getTime();
      out.push({ id: `task-${task.id}`, kind: 'task', ts: ts || 0, task });
    }
    for (const comm of comms) {
      out.push({
        id: `comm-${comm.id}`,
        kind: 'communication',
        ts: new Date(comm.created_date || 0).getTime() || 0,
        comm,
      });
    }
    out.sort((a, b) => b.ts - a.ts);
    return out;
  }, [logs, closedTasks, comms]);

  const filtered = filter === 'all' ? events : events.filter((e) => e.kind === filter);

  return (
    /* Full-height card so it can sit as a side rail (modal: parent gives it a
       fixed height → the body scrolls; full-page: it just grows). The blue
       right-accent matches the lead screen's accent language. */
    <div className="h-full flex flex-col rounded-xl border border-black/[0.06] border-r-4 border-r-blue-500 bg-card shadow-card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <Activity className="h-4 w-4 text-blue-500" />
          פעילות הליד
        </h3>
        <div className="inline-flex bg-muted rounded-lg p-0.5 gap-0.5 text-xs">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                filter === f.key
                  ? 'bg-card shadow-sm text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground text-sm">טוען…</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground">
            <Clock className="h-10 w-10 mx-auto mb-3 opacity-20" />
            <p className="text-sm">אין פעילות עדיין</p>
          </div>
        ) : (
          <ol className="space-y-0">
            {filtered.map((event, index) => {
              const isLast = index === filtered.length - 1;
              return event.kind === 'task'
                ? renderTaskEvent(event.task, isLast, users, onOpenTask)
                : event.kind === 'communication'
                ? renderCommunicationEvent(event.comm, isLast, users)
                : renderChangeEvent(event.log, isLast, users);
            })}
          </ol>
        )}
      </div>
    </div>
  );
}

// ── renderers ─────────────────────────────────────────────────────────────
function Rail({ isLast }) {
  if (isLast) return null;
  return <span className="absolute top-8 right-[15px] w-[2px] h-[calc(100%-8px)] bg-border" aria-hidden />;
}

function renderChangeEvent(log, isLast, users) {
  const Icon = actionIcons[log.action_type] || Edit3;
  const colorClass = actionColors[log.action_type] || 'bg-muted text-foreground/80';
  const label = actionLabels[log.action_type] || log.action_type;

  return (
    <li key={`log-${log.id}`} className="flex gap-3 relative">
      <Rail isLast={isLast} />
      <span className={`relative z-10 flex-shrink-0 h-8 w-8 rounded-full flex items-center justify-center ${colorClass}`}>
        <Icon className="h-3.5 w-3.5" />
      </span>
      <div className="flex-1 pb-5 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-0.5">
          <span className="inline-flex items-center rounded border border-border text-[10px] h-5 px-1.5 text-muted-foreground">
            {label}
          </span>
          <span className="text-[11px] text-muted-foreground/70">
            {formatInTimeZone(log.created_date || new Date().toISOString(), 'Asia/Jerusalem', 'dd/MM/yyyy HH:mm')}
          </span>
        </div>

        <p className="text-sm text-foreground">{formatDescription(log.action_description, users)}</p>

        {log.field_name && log.old_value != null && log.new_value != null && (
          <div className="mt-1 text-xs text-muted-foreground flex items-center gap-1 flex-wrap">
            <span className="bg-red-50 text-red-600 px-1.5 py-0.5 rounded line-through">
              {humanizeValue(log.old_value, users) || '(ריק)'}
            </span>
            <span className="text-muted-foreground/70">&larr;</span>
            <span className="bg-green-50 text-green-600 px-1.5 py-0.5 rounded">
              {humanizeValue(log.new_value, users) || '(ריק)'}
            </span>
          </div>
        )}

        <p className="text-[11px] text-muted-foreground/70 mt-0.5">
          {humanizeEmails(log.performed_by_name, users)}
        </p>
      </div>
    </li>
  );
}

function renderCommunicationEvent(comm, isLast, users) {
  const meta = COMM_TYPE[comm.type] || COMM_TYPE.call;
  const Icon = meta.icon;
  const dir = comm.direction === 'inbound' ? 'נכנס' : comm.direction === 'outbound' ? 'יוצא' : null;
  const when = comm.created_date;

  return (
    <li key={`comm-${comm.id}`} className="flex gap-3 relative">
      <Rail isLast={isLast} />
      <span className={`relative z-10 flex-shrink-0 h-8 w-8 rounded-full flex items-center justify-center ${meta.tone}`}>
        <Icon className="h-3.5 w-3.5" />
      </span>
      <div className="flex-1 pb-5 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-0.5">
          <span className={`inline-flex items-center gap-1 rounded-lg text-[10px] h-5 px-2 font-semibold ${meta.tone}`}>
            <Icon className="h-3 w-3" />
            {meta.label}
          </span>
          {dir && (
            <span className="inline-flex items-center rounded border border-border text-[10px] h-5 px-1.5 text-muted-foreground">
              {dir}
            </span>
          )}
          {comm.outcome && COMM_OUTCOME_LABELS[comm.outcome] && (
            <span className="inline-flex items-center rounded-full text-[10px] h-5 px-2 bg-muted text-foreground/70">
              {COMM_OUTCOME_LABELS[comm.outcome]}
            </span>
          )}
          <span className="text-[11px] text-muted-foreground/70">
            {when ? formatInTimeZone(when, 'Asia/Jerusalem', 'dd/MM/yyyy HH:mm') : ''}
          </span>
        </div>

        {comm.subject && <p className="text-sm font-medium text-foreground">{comm.subject}</p>}
        {comm.content && (
          <p className="text-[13px] text-foreground/80 whitespace-pre-wrap break-words mt-0.5">{comm.content}</p>
        )}
        {comm.notes && <p className="text-[11px] text-muted-foreground/70 italic mt-1">{comm.notes}</p>}

        <p className="text-[11px] text-muted-foreground/70 mt-0.5">
          {comm.rep_id ? getRepDisplayName(comm.rep_id, users) : ''}
        </p>
      </div>
    </li>
  );
}

function renderTaskEvent(task, isLast, users, onOpenTask) {
  const outcome = TASK_OUTCOME[task.task_status] || TASK_OUTCOME.cancelled;
  const OutcomeIcon = outcome.icon;
  const typeChip = TASK_TYPE_CHIP[task.task_type] || FALLBACK_TASK_TYPE_CHIP;
  const TypeIcon = typeChip.icon;
  const taskTypeLabel = ALL_TASK_TYPE_LABELS[task.task_type] || 'אחר';
  const when = task.updated_date || task.created_date || task.manual_created_date;

  return (
    <li key={`task-${task.id}`} className="flex gap-3 relative">
      <Rail isLast={isLast} />
      <span className={`relative z-10 flex-shrink-0 h-8 w-8 rounded-full flex items-center justify-center ${outcome.dot}`}>
        <OutcomeIcon className="h-3.5 w-3.5" />
      </span>
      <button
        type="button"
        onClick={() => onOpenTask?.(task)}
        className="flex-1 pb-5 min-w-0 text-right group"
      >
        <div className="flex items-center gap-2 flex-wrap mb-0.5">
          <span className={`inline-flex items-center gap-1 rounded-lg text-[10px] h-5 px-2 font-semibold ${typeChip.tone}`}>
            <TypeIcon className="h-3 w-3" />
            {taskTypeLabel}
          </span>
          <span className={`inline-flex items-center gap-1 rounded-full text-[10px] h-5 px-2 font-medium ${outcome.pill}`}>
            <OutcomeIcon className="h-3 w-3" />
            {outcome.label}
          </span>
          <span className="text-[11px] text-muted-foreground/70">
            {when ? formatInTimeZone(when, 'Asia/Jerusalem', 'dd/MM/yyyy HH:mm') : ''}
          </span>
        </div>

        {task.status && (
          <div className="mt-1.5 flex items-center gap-2 flex-wrap text-xs">
            <span className="text-muted-foreground">סטטוס שעודכן:</span>
            <StatusBadge status={task.status} />
          </div>
        )}

        {task.summary && (
          <div className="mt-2 rounded-lg bg-muted/60 border border-border/60 px-3 py-2 text-[13px] text-foreground/80 leading-relaxed group-hover:bg-muted transition-colors whitespace-pre-wrap break-words">
            {task.summary}
          </div>
        )}

        <p className="text-[11px] text-muted-foreground/70 mt-1">
          {task.rep1 ? getRepDisplayName(task.rep1, users) : 'לא משויך'}
        </p>
      </button>
    </li>
  );
}
