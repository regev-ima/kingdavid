import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CalendarDays, ChevronRight, ChevronLeft, Plus, X, Check, Lock, Loader2, Search } from 'lucide-react';
import { startOfWeek, addDays, addWeeks, format } from '@/lib/safe-date-fns';
import { useImpersonation } from '@/components/shared/ImpersonationContext';
import { canEditSchedule } from '@/lib/rbac';

// ── Static config ─────────────────────────────────────────────────
// Israeli work week: Sunday → Friday (6 columns).
const DAY_LABELS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי'];

// The three shift rows from the manager's spreadsheet. Colours echo the Excel
// (cyan morning / purple evening / amber day-off).
const SHIFTS = [
  { key: 'morning', label: 'בוקר', time: '8:45 – 17:00', head: 'bg-cyan-100 text-cyan-900 border-cyan-200' },
  { key: 'evening', label: 'ערב',  time: '12:00 – 20:00', head: 'bg-purple-100 text-purple-900 border-purple-200' },
  { key: 'off',     label: 'חופש', time: '',              head: 'bg-amber-100 text-amber-900 border-amber-200' },
];

// Stable pastel per rep so the same person looks the same across every cell.
const CHIP_COLORS = [
  'bg-blue-100 text-blue-800', 'bg-emerald-100 text-emerald-800', 'bg-amber-100 text-amber-800',
  'bg-purple-100 text-purple-800', 'bg-pink-100 text-pink-800', 'bg-cyan-100 text-cyan-800',
  'bg-orange-100 text-orange-800', 'bg-indigo-100 text-indigo-800', 'bg-teal-100 text-teal-800',
  'bg-rose-100 text-rose-800',
];
function chipColor(email) {
  let h = 0;
  for (const ch of String(email || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return CHIP_COLORS[h % CHIP_COLORS.length];
}

const iso = (d) => format(d, 'yyyy-MM-dd');
const todayIso = () => format(new Date(), 'yyyy-MM-dd');

export default function Schedule() {
  const { getEffectiveUser } = useImpersonation();
  const queryClient = useQueryClient();

  const [user, setUser] = useState(null);
  React.useEffect(() => { base44.auth.me().then(setUser).catch(() => {}); }, []);
  const effectiveUser = getEffectiveUser(user);
  const canEdit = canEditSchedule(effectiveUser);
  const myEmail = effectiveUser?.email || '';

  // Which week is shown — anchored to its Sunday.
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 0 }));
  const days = useMemo(
    () => Array.from({ length: 6 }, (_, i) => {
      const date = addDays(weekStart, i);
      return { date, key: iso(date), dayLabel: DAY_LABELS[i], dateLabel: format(date, 'd.M') };
    }),
    [weekStart],
  );
  const weekKey = iso(weekStart);
  const rangeLabel = `${format(days[0].date, 'd.M')} – ${format(days[5].date, 'd.M.yy')}`;

  // Reps available for assignment (active users), for the picker + name lookup.
  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => base44.entities.User.list(),
    staleTime: 5 * 60_000,
  });
  const reps = useMemo(
    () => users
      .filter((u) => u.is_active !== false && u.email)
      .sort((a, b) => (a.full_name || a.email).localeCompare(b.full_name || b.email, 'he')),
    [users],
  );
  const nameByEmail = useMemo(() => {
    const m = new Map();
    for (const u of users) m.set(u.email, u.full_name || u.email);
    return m;
  }, [users]);

  // Assignments for the visible week.
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['shift-assignments', weekKey],
    queryFn: () => base44.entities.ShiftAssignment.filter({
      work_date: { $gte: days[0].key, $lte: days[5].key },
    }),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
  // Map "date|shift" → { id, rep_emails }.
  const cells = useMemo(() => {
    const m = new Map();
    for (const r of rows) {
      const d = String(r.work_date).slice(0, 10);
      m.set(`${d}|${r.shift}`, { id: r.id, rep_emails: Array.isArray(r.rep_emails) ? r.rep_emails : [] });
    }
    return m;
  }, [rows]);
  const getCell = (dateKey, shift) => cells.get(`${dateKey}|${shift}`) || { id: null, rep_emails: [] };

  // Save a single cell (create / update / delete). Optimistic so toggles feel
  // instant; reconciled on settle.
  const queryKey = ['shift-assignments', weekKey];
  const saveCell = useMutation({
    mutationFn: async ({ dateKey, shift, repEmails, existingId }) => {
      if (existingId) {
        if (repEmails.length === 0) return base44.entities.ShiftAssignment.delete(existingId);
        return base44.entities.ShiftAssignment.update(existingId, { rep_emails: repEmails, updated_by: myEmail });
      }
      if (repEmails.length > 0) {
        return base44.entities.ShiftAssignment.create({ work_date: dateKey, shift, rep_emails: repEmails, updated_by: myEmail });
      }
      return null;
    },
    onMutate: async ({ dateKey, shift, repEmails }) => {
      await queryClient.cancelQueries({ queryKey });
      const prev = queryClient.getQueryData(queryKey);
      queryClient.setQueryData(queryKey, (old = []) => {
        const next = [...(old || [])];
        const idx = next.findIndex((r) => String(r.work_date).slice(0, 10) === dateKey && r.shift === shift);
        if (idx >= 0) {
          if (repEmails.length === 0) next.splice(idx, 1);
          else next[idx] = { ...next[idx], rep_emails: repEmails };
        } else if (repEmails.length > 0) {
          next.push({ id: `temp-${dateKey}-${shift}`, work_date: dateKey, shift, rep_emails: repEmails });
        }
        return next;
      });
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(queryKey, ctx.prev);
      toast.error('שמירת השיבוץ נכשלה');
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });

  const toggleRep = (dateKey, shift, repEmail) => {
    if (!canEdit) return;
    const cell = getCell(dateKey, shift);
    const has = cell.rep_emails.includes(repEmail);
    const repEmails = has ? cell.rep_emails.filter((e) => e !== repEmail) : [...cell.rep_emails, repEmail];
    saveCell.mutate({ dateKey, shift, repEmails, existingId: cell.id });
  };

  return (
    <div className="space-y-4" dir="rtl">
      {/* Header + week navigation */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <CalendarDays className="h-6 w-6 text-primary" />
            שיבוץ משמרות
          </h1>
          <p className="text-sm text-muted-foreground">
            {canEdit ? 'שבץ נציגים למשמרות — הנציגים רואים את הלוח בזמן אמת.' : 'לוח המשמרות השבועי של הצוות.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canEdit ? (
            <span className="hidden sm:inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
              <Check className="h-3 w-3" /> מצב עריכה
            </span>
          ) : (
            <span className="hidden sm:inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
              <Lock className="h-3 w-3" /> צפייה בלבד
            </span>
          )}
        </div>
      </div>

      {/* Week switcher */}
      <div className="flex items-center justify-between gap-2 rounded-xl border border-border bg-card p-2 shadow-card">
        <Button variant="outline" size="sm" className="gap-1" onClick={() => setWeekStart((w) => addWeeks(w, 1))}>
          <ChevronLeft className="h-4 w-4" /> שבוע הבא
        </Button>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-foreground tabular-nums">{rangeLabel}</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-primary"
            onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 0 }))}
          >
            השבוע
          </Button>
          {saveCell.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" /> : null}
        </div>
        <Button variant="outline" size="sm" className="gap-1" onClick={() => setWeekStart((w) => addWeeks(w, -1))}>
          שבוע קודם <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* The board */}
      <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-card">
        <table className="w-full min-w-[820px] border-collapse">
          <thead>
            <tr>
              <th className="sticky right-0 z-10 bg-card w-28 border-b border-l border-border p-2 text-xs font-semibold text-muted-foreground">
                משמרת
              </th>
              {days.map((d) => {
                const isToday = d.key === todayIso();
                return (
                  <th key={d.key} className={`border-b border-l border-border p-2 text-center ${isToday ? 'bg-emerald-500 text-white' : 'bg-emerald-50 text-emerald-900'}`}>
                    <div className="text-sm font-bold">{d.dayLabel}</div>
                    <div className={`text-[11px] tabular-nums ${isToday ? 'text-white/90' : 'text-emerald-700/80'}`}>{d.dateLabel}</div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {SHIFTS.map((shift) => (
              <tr key={shift.key} className="align-top">
                <th className={`sticky right-0 z-10 w-28 border-b border-l border-border p-2 text-right ${shift.head}`}>
                  <div className="text-sm font-bold">{shift.label}</div>
                  {shift.time ? <div className="text-[10px] opacity-80 tabular-nums" dir="ltr">{shift.time}</div> : null}
                </th>
                {days.map((d) => {
                  const cell = getCell(d.key, shift.key);
                  return (
                    <td key={d.key} className="border-b border-l border-border p-1.5 min-w-[120px]">
                      <div className="flex flex-wrap gap-1">
                        {cell.rep_emails.map((email) => {
                          const mine = email === myEmail;
                          return (
                            <span
                              key={email}
                              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${chipColor(email)} ${mine ? 'ring-2 ring-primary ring-offset-1' : ''}`}
                              title={nameByEmail.get(email) || email}
                            >
                              {nameByEmail.get(email) || email}
                              {canEdit ? (
                                <button
                                  type="button"
                                  onClick={() => toggleRep(d.key, shift.key, email)}
                                  className="opacity-60 hover:opacity-100"
                                  aria-label="הסר"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              ) : null}
                            </span>
                          );
                        })}

                        {canEdit ? (
                          <RepPicker
                            reps={reps}
                            selected={cell.rep_emails}
                            onToggle={(email) => toggleRep(d.key, shift.key, email)}
                          />
                        ) : cell.rep_emails.length === 0 ? (
                          <span className="text-xs text-muted-foreground/40">—</span>
                        ) : null}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {isLoading && rows.length === 0 ? (
          <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : null}
      </div>

      {!canEdit ? (
        <p className="text-[11px] text-muted-foreground flex items-center gap-1">
          <Lock className="h-3 w-3" /> רק מנהל (או נציג עם הרשאת "עריכת שיבוץ משמרות") יכול לשבץ. אתה רואה את הלוח בלבד.
        </p>
      ) : null}
    </div>
  );
}

// ── Per-cell rep picker ───────────────────────────────────────────
function RepPicker({ reps, selected, onToggle }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return reps;
    return reps.filter((r) => (r.full_name || '').toLowerCase().includes(s) || (r.email || '').toLowerCase().includes(s));
  }, [reps, q]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground hover:border-primary hover:text-primary transition-colors"
          aria-label="הוסף נציג"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-60 p-2" align="start" dir="rtl">
        <div className="relative mb-2">
          <Search className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="חפש נציג..." className="h-8 pr-8 text-sm" />
        </div>
        <div className="max-h-60 overflow-y-auto space-y-0.5">
          {filtered.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-3">אין תוצאות</p>
          ) : filtered.map((r) => {
            const isSel = selected.includes(r.email);
            return (
              <button
                key={r.email}
                type="button"
                onClick={() => onToggle(r.email)}
                className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm text-right hover:bg-muted ${isSel ? 'bg-primary/5' : ''}`}
              >
                <span className="truncate">{r.full_name || r.email}</span>
                {isSel ? <Check className="h-4 w-4 text-primary shrink-0" /> : null}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
