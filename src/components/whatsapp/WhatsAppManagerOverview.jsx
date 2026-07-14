import React, { useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { parseDbTimestamp } from '@/lib/safe-date-fns-tz';
import UserAvatar from '@/components/shared/UserAvatar';
import { Users, Timer, Clock, Loader2, Trash2 } from 'lucide-react';
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader,
  AlertDialogFooter, AlertDialogTitle, AlertDialogDescription,
  AlertDialogAction, AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { formatDuration } from './whatsappHelpers';

const PERIODS = [
  { value: 'today', label: 'היום' },
  { value: '7d', label: '7 ימים' },
  { value: '30d', label: '30 ימים' },
  { value: 'all', label: 'כל הזמנים' },
];

function periodStartMs(period, now) {
  const d = new Date(now);
  if (period === 'today') { d.setHours(0, 0, 0, 0); return d.getTime(); }
  if (period === '7d') return now - 7 * 86400000;
  if (period === '30d') return now - 30 * 86400000;
  return 0;
}

// Urgency colour for how long the oldest waiting customer has waited (seconds).
function waitChipClass(seconds) {
  if (seconds < 15 * 60) return 'bg-amber-100 text-amber-700';
  if (seconds < 60 * 60) return 'bg-orange-100 text-orange-700';
  return 'bg-red-600 text-white';
}

// One rep card — same visual language as the "עומס לפי נציג" cards on
// /LeadManagement: a bordered card, a clickable header, a 2×2 grid of soft
// coloured buckets, and a total / "פנוי" line at the bottom.
function RepWaCard({ id, label, avatar, stats, repActive, activeStatus, onFilter, avgSeconds, repliesCount, oldestWaitSec }) {
  const headerActive = repActive && activeStatus === 'all';
  const cardCls = repActive ? 'border-primary bg-primary/5 ring-2 ring-primary/40' : 'border-border bg-card hover:border-foreground/30';
  return (
    <div className={`rounded-xl border-2 p-2.5 shadow-card transition-all ${cardCls}`}>
      <button
        type="button"
        onClick={() => onFilter(id, 'all')}
        className={`w-full text-right flex items-center gap-2 mb-2 min-w-0 rounded-lg px-1 py-0.5 transition-colors hover:bg-muted/40 ${headerActive ? 'bg-muted/40' : ''}`}
        title={`סנן לפי ${label}`}
      >
        {avatar}
        <span className="text-xs font-semibold truncate flex-1" title={label}>{label}</span>
      </button>

      <div className="grid grid-cols-2 gap-1.5 text-xs">
        {stats.map((s) => {
          const active = repActive && activeStatus === s.status;
          const clickable = !!s.status;
          return (
            <button
              key={s.key}
              type="button"
              disabled={!clickable}
              onClick={clickable ? () => onFilter(id, s.status) : undefined}
              title={s.title}
              className={`${s.box} rounded p-1.5 text-center border transition-all ${
                active ? `ring-2 ${s.ring}` : 'border-transparent'
              } ${clickable ? 'hover:brightness-95 cursor-pointer' : 'cursor-default'}`}
            >
              <p className={`text-[10px] leading-tight ${s.sub}`}>{s.label}</p>
              <p className={`text-base font-bold tabular-nums leading-tight ${s.text}`}>{s.value}</p>
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-2 mt-1.5">
        <span className="text-[10px] text-muted-foreground inline-flex items-center gap-1">
          <Timer className="h-3 w-3" />
          {repliesCount > 0 && avgSeconds != null ? formatDuration(avgSeconds) : '—'}
        </span>
        {oldestWaitSec != null ? (
          <span className={`text-[10px] font-semibold inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 ${waitChipClass(oldestWaitSec)}`}>
            <Clock className="h-3 w-3" />ממתין {formatDuration(oldestWaitSec)}
          </span>
        ) : (
          <span className="text-[10px] text-muted-foreground">פנוי</span>
        )}
      </div>
    </div>
  );
}

// Manager bird's-eye view above the chat: per-rep numbers for the chosen period,
// click-to-filter, and a live "longest waiting" timer.
export default function WhatsAppManagerOverview({
  chats = [], usersById = {}, viewStatsById = {}, period, setPeriod,
  now, activeRep, activeStatus, onFilter,
}) {
  const queryClient = useQueryClient();
  const startMs = useMemo(() => periodStartMs(period, now), [period, now]);

  // Admin-only "wipe everyone's history" — same purge as WhatsAppSettingsTab,
  // looped server-side over every connected account. Credentials/connections
  // are kept; only recorded chats/messages are deleted, and recording
  // continues for new messages going forward.
  const purgeAllMutation = useMutation({
    mutationFn: () => base44.functions.invoke('greenApiSettings', { action: 'purge_all' }),
    onSuccess: (res) => {
      toast.success(`ההיסטוריה נמחקה לכל הצוות (${res?.purged_count ?? 0} חשבונות)`);
      queryClient.invalidateQueries({ queryKey: ['wa-chats'] });
      queryClient.invalidateQueries({ queryKey: ['wa-waiting-count'] });
      queryClient.invalidateQueries({ queryKey: ['wa-rep-stats'] });
      queryClient.invalidateQueries({ queryKey: ['wa-my-stats'] });
    },
    onError: (err) => toast.error(`המחיקה נכשלה: ${err?.message || 'שגיאה'}`),
  });

  const { reps, team } = useMemo(() => {
    const map = {};
    const t = { total: 0, waiting: 0, answeredPeriod: 0, activePeriod: 0, oldestWaitingMs: null };
    for (const c of chats) {
      const uid = c.user_id;
      if (!uid) continue;
      if (!map[uid]) map[uid] = { user_id: uid, total: 0, waiting: 0, answeredPeriod: 0, activePeriod: 0, oldestWaitingMs: null };
      const m = map[uid];
      const lastMs = parseDbTimestamp(c.last_message_at)?.getTime() ?? 0;
      m.total += 1; t.total += 1;
      if (lastMs >= startMs) {
        m.activePeriod += 1; t.activePeriod += 1;
        if (c.status === 'answered') { m.answeredPeriod += 1; t.answeredPeriod += 1; }
      }
      if (c.status === 'waiting') {
        m.waiting += 1; t.waiting += 1;
        if (lastMs) {
          if (m.oldestWaitingMs == null || lastMs < m.oldestWaitingMs) m.oldestWaitingMs = lastMs;
          if (t.oldestWaitingMs == null || lastMs < t.oldestWaitingMs) t.oldestWaitingMs = lastMs;
        }
      }
    }
    const reps = Object.values(map).sort((a, b) => b.waiting - a.waiting || b.activePeriod - a.activePeriod);
    return { reps, team: t };
  }, [chats, startMs]);

  const buckets = (m) => [
    { key: 'active', label: 'פעילות', value: m.activePeriod, status: 'all', title: 'שיחות עם פעילות בתקופה', box: 'bg-sky-50', text: 'text-sky-700', sub: 'text-sky-700/80', ring: 'ring-sky-400 border-sky-500' },
    { key: 'waiting', label: 'ממתינים', value: m.waiting, status: 'waiting', title: 'שיחות שממתינות לתשובה', box: 'bg-rose-50', text: 'text-rose-700', sub: 'text-rose-700/80', ring: 'ring-rose-400 border-rose-500' },
    { key: 'answered', label: 'טופלו', value: m.answeredPeriod, status: 'answered', title: 'שיחות שטופלו בתקופה', box: 'bg-emerald-50', text: 'text-emerald-700', sub: 'text-emerald-700/80', ring: 'ring-emerald-400 border-emerald-500' },
    { key: 'total', label: 'סה״כ', value: m.total, status: null, title: 'סך השיחות שהנציג מנהל', box: 'bg-slate-100', text: 'text-slate-700', sub: 'text-slate-600/80', ring: 'ring-slate-400 border-slate-500' },
  ];

  const teamOldestSec = team.oldestWaitingMs ? Math.max(0, (now - team.oldestWaitingMs) / 1000) : null;

  return (
    <div className="shrink-0 border-b bg-muted/20 px-3 py-2.5 space-y-2.5">
      {/* Period filter — matches the date-range pills on /LeadManagement */}
      <div className="flex items-center gap-2 flex-wrap bg-card border border-border rounded-xl p-2 shadow-card">
        <span className="text-xs font-medium text-muted-foreground ms-1">טווח זמן:</span>
        {PERIODS.map((p) => {
          const active = period === p.value;
          return (
            <button
              key={p.value}
              type="button"
              onClick={() => setPeriod(p.value)}
              className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-all ${
                active ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-2 px-1">
        <p className="text-xs font-semibold text-muted-foreground flex items-center gap-2">
          <Users className="h-3.5 w-3.5" />
          מבט-על לפי נציג ({reps.length} בצוות)
        </p>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <button
              type="button"
              disabled={purgeAllMutation.isPending}
              className="text-[11px] text-destructive/80 hover:text-destructive inline-flex items-center gap-1 disabled:opacity-50"
            >
              {purgeAllMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
              נקה את כל ההיסטוריה של כולם
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent dir="rtl">
            <AlertDialogHeader>
              <AlertDialogTitle>למחוק את כל ההיסטוריה — של כל הצוות?</AlertDialogTitle>
              <AlertDialogDescription>
                כל השיחות וההודעות שתועדו עבור כל חשבונות הוואטסאפ המחוברים יימחקו לצמיתות ולא ניתן
                יהיה לשחזר אותן. החיבורים עצמם יישארו, ותיעוד הודעות חדשות יימשך.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>ביטול</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => purgeAllMutation.mutate()}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                כן, מחק את הכל
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <div className="max-h-[40vh] overflow-y-auto">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2">
          {/* All-team card first */}
          <RepWaCard
            id="all"
            label="כל הצוות"
            avatar={<span className="h-8 w-8 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center shrink-0">כל</span>}
            stats={buckets(team)}
            repActive={activeRep == null}
            activeStatus={activeStatus}
            onFilter={onFilter}
            avgSeconds={null}
            repliesCount={0}
            oldestWaitSec={teamOldestSec}
          />
          {reps.map((r) => {
            const u = usersById[r.user_id];
            const oldestWaitSec = r.oldestWaitingMs ? Math.max(0, (now - r.oldestWaitingMs) / 1000) : null;
            return (
              <RepWaCard
                key={r.user_id}
                id={r.user_id}
                label={u?.full_name || u?.email || '—'}
                avatar={<UserAvatar user={u} size="sm" />}
                stats={buckets(r)}
                repActive={activeRep === r.user_id}
                activeStatus={activeStatus}
                onFilter={onFilter}
                avgSeconds={viewStatsById[r.user_id]?.avg_response_seconds}
                repliesCount={viewStatsById[r.user_id]?.replies_count || 0}
                oldestWaitSec={oldestWaitSec}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
