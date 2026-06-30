import React, { useMemo } from 'react';
import { parseDbTimestamp } from '@/lib/safe-date-fns-tz';
import UserAvatar from '@/components/shared/UserAvatar';
import { Clock, Timer, MessageSquare } from 'lucide-react';
import { formatDuration } from './whatsappHelpers';

const PERIODS = [
  { value: 'today', label: 'היום' },
  { value: '7d', label: '7 ימים' },
  { value: '30d', label: '30 ימים' },
  { value: 'all', label: 'הכל' },
];

function periodStartMs(period, now) {
  const d = new Date(now);
  if (period === 'today') { d.setHours(0, 0, 0, 0); return d.getTime(); }
  if (period === '7d') return now - 7 * 86400000;
  if (period === '30d') return now - 30 * 86400000;
  return 0;
}

// Urgency colour for a wait duration (seconds).
function waitChipClass(seconds) {
  if (seconds < 15 * 60) return 'bg-amber-100 text-amber-700';
  if (seconds < 60 * 60) return 'bg-orange-100 text-orange-700';
  return 'bg-red-600 text-white';
}

function MiniStat({ label, value, tone = 'default', active, onClick }) {
  const toneCls = {
    default: 'text-foreground',
    waiting: value > 0 ? 'text-red-600' : 'text-muted-foreground',
    answered: 'text-green-600',
    muted: 'text-muted-foreground',
  }[tone];
  const clickable = !!onClick;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!clickable}
      className={`flex flex-col items-center justify-center rounded-md px-1.5 py-1 transition-colors ${
        clickable ? 'hover:bg-muted cursor-pointer' : 'cursor-default'
      } ${active ? 'ring-2 ring-primary bg-primary/5' : ''}`}
    >
      <span className={`text-base font-bold leading-none ${toneCls}`}>{value}</span>
      <span className="text-[10px] text-muted-foreground mt-0.5">{label}</span>
    </button>
  );
}

// Manager bird's-eye view: one card per rep with their numbers for the chosen
// period, plus a live "longest waiting" timer. Clicking a number filters the
// chat list (e.g. a rep's "ממתינים" → just their waiting conversations).
export default function WhatsAppManagerOverview({
  chats = [], usersById = {}, viewStatsById = {}, period, setPeriod,
  now, activeRep, activeStatus, onFilter,
}) {
  const startMs = useMemo(() => periodStartMs(period, now), [period, now]);

  const reps = useMemo(() => {
    const map = {};
    for (const c of chats) {
      const uid = c.user_id;
      if (!uid) continue;
      if (!map[uid]) map[uid] = { user_id: uid, total: 0, waiting: 0, answeredPeriod: 0, activePeriod: 0, oldestWaitingMs: null };
      const m = map[uid];
      m.total += 1;
      const lastMs = parseDbTimestamp(c.last_message_at)?.getTime() ?? 0;
      if (lastMs >= startMs) {
        m.activePeriod += 1;
        if (c.status === 'answered') m.answeredPeriod += 1;
      }
      if (c.status === 'waiting') {
        m.waiting += 1;
        if (lastMs && (m.oldestWaitingMs == null || lastMs < m.oldestWaitingMs)) m.oldestWaitingMs = lastMs;
      }
    }
    return Object.values(map).sort((a, b) => b.waiting - a.waiting || b.activePeriod - a.activePeriod);
  }, [chats, startMs]);

  const teamWaiting = reps.reduce((s, r) => s + r.waiting, 0);
  const teamActive = reps.reduce((s, r) => s + r.activePeriod, 0);

  return (
    <div className="shrink-0 border-b bg-muted/20 px-3 py-2.5 space-y-2">
      {/* Period filter + team summary */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="inline-flex items-center rounded-lg bg-background border p-0.5">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              className={`text-xs px-2.5 py-1 rounded-md transition-colors ${
                period === p.value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1"><MessageSquare className="h-3.5 w-3.5" />{teamActive} פעילות</span>
          <span className={`inline-flex items-center gap-1 ${teamWaiting > 0 ? 'text-red-600 font-medium' : ''}`}>
            <Clock className="h-3.5 w-3.5" />{teamWaiting} ממתינים
          </span>
        </div>
      </div>

      {/* Per-rep cards */}
      <div className="flex gap-2.5 overflow-x-auto pb-1">
        {reps.length === 0 && (
          <p className="text-xs text-muted-foreground py-3">אין עדיין נתונים להצגה.</p>
        )}
        {reps.map((r) => {
          const u = usersById[r.user_id];
          const avg = viewStatsById[r.user_id]?.avg_response_seconds;
          const repliesCount = viewStatsById[r.user_id]?.replies_count || 0;
          const oldestWaitSec = r.oldestWaitingMs ? Math.max(0, (now - r.oldestWaitingMs) / 1000) : null;
          const isActiveRep = activeRep === r.user_id;
          return (
            <div
              key={r.user_id}
              className={`shrink-0 w-[230px] rounded-xl border bg-card p-2.5 space-y-2 ${isActiveRep ? 'ring-2 ring-primary' : ''}`}
            >
              <button
                type="button"
                onClick={() => onFilter(r.user_id, 'all')}
                className="flex items-center gap-2 w-full text-right min-w-0"
                title="הצג את כל השיחות של הנציג"
              >
                <UserAvatar user={u} size="sm" />
                <span className="font-medium text-sm truncate flex-1">{u?.full_name || u?.email || '—'}</span>
              </button>

              <div className="grid grid-cols-4 gap-1 bg-muted/40 rounded-lg p-1">
                <MiniStat label="פעילות" value={r.activePeriod} onClick={() => onFilter(r.user_id, 'all')} active={isActiveRep && activeStatus === 'all'} />
                <MiniStat label="ממתינים" value={r.waiting} tone="waiting" onClick={() => onFilter(r.user_id, 'waiting')} active={isActiveRep && activeStatus === 'waiting'} />
                <MiniStat label="טופלו" value={r.answeredPeriod} tone="answered" onClick={() => onFilter(r.user_id, 'answered')} active={isActiveRep && activeStatus === 'answered'} />
                <MiniStat label="סה״כ" value={r.total} tone="muted" />
              </div>

              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <Timer className="h-3 w-3" />
                  {repliesCount > 0 && avg != null ? formatDuration(avg) : '—'}
                </span>
                {oldestWaitSec != null && (
                  <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 ${waitChipClass(oldestWaitSec)}`}>
                    <Clock className="h-3 w-3" />
                    ממתין {formatDuration(oldestWaitSec)}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
