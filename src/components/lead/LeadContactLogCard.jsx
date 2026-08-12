import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import {
  CalendarDays,
  Mail,
  MessageCircle,
  Phone,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  Plus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import StatusBadge from '@/components/shared/StatusBadge';
import RecordingPlayer from '@/components/call/RecordingPlayer';
import { formatInTimeZone } from '@/lib/safe-date-fns-tz';
import { getRepDisplayName } from '@/lib/repDisplay';
import { hebrewTimeAgo } from '@/lib/hebrewDuration';
import { buildContactLog, contactOutcomeLabel, formatCallDuration } from '@/lib/leadContactLog';

/**
 * "מתי דיברו איתו" — every conversation with this lead, newest first.
 *
 * The question this card exists for used to have no answer on the lead screen.
 * Phone calls live in `call_logs` (Voicenter's CDR sync and click-to-call) and
 * nothing on the page read that table; the activity feed showed status changes
 * and closed tasks, so a rep looking for "when did anyone last reach him"
 * scrolled through system events and still didn't find a call. Here it's the
 * card's headline: how many, and how long ago the last one was.
 *
 * Manually-logged communication is in the same list on purpose. A WhatsApp
 * exchange or a call from a rep's private phone is contact with the customer
 * just as much as a call the switchboard happened to see, and which table it
 * landed in is an implementation detail the rep shouldn't have to know.
 */
const TYPE_META = {
  call:     { label: 'שיחה',    icon: Phone,         tone: 'bg-blue-100 text-blue-700' },
  whatsapp: { label: 'וואטסאפ', icon: MessageCircle, tone: 'bg-green-100 text-green-700' },
  email:    { label: 'אימייל',  icon: Mail,          tone: 'bg-purple-100 text-purple-700' },
  meeting:  { label: 'פגישה',   icon: CalendarDays,  tone: 'bg-amber-100 text-amber-700' },
};
const FALLBACK_TYPE = { label: 'תקשורת', icon: MessageCircle, tone: 'bg-muted text-muted-foreground' };

// A call that nobody picked up is the one entry a rep must not misread as a
// conversation, so it gets its own icon and a red tone instead of the neutral
// blue every other call carries.
const UNANSWERED = ['no_answer', 'busy'];

function entryVisual(entry) {
  const meta = TYPE_META[entry.type] || FALLBACK_TYPE;
  if (entry.type !== 'call') return meta;
  if (UNANSWERED.includes(entry.outcome)) {
    return { ...meta, icon: PhoneMissed, tone: 'bg-rose-100 text-rose-700' };
  }
  return { ...meta, icon: entry.direction === 'inbound' ? PhoneIncoming : PhoneOutgoing };
}

const DIRECTION_LABELS = { inbound: 'נכנסת', outbound: 'יוצאת' };

export default function LeadContactLogCard({ leadId, users = [], onAddCommunication }) {
  const { data: entries = [], isLoading } = useQuery({
    queryKey: ['lead-contact-log', leadId],
    enabled: !!leadId,
    staleTime: 60_000,
    queryFn: async () => {
      const [calls, comms] = await Promise.all([
        base44.entities.CallLog.filter({ lead_id: leadId }),
        base44.entities.CommunicationLog.filter({ lead_id: leadId }),
      ]);
      return buildContactLog(calls, comms);
    },
  });

  const last = entries[0] || null;

  return (
    <section className="rounded-2xl border border-border bg-card shadow-card overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 py-3.5">
        <span className="inline-flex items-center gap-2 text-sm font-bold min-w-0">
          <Phone className="h-4 w-4 text-primary flex-shrink-0" />
          שיחות ותקשורת
          {entries.length > 0 ? (
            <span className="inline-flex items-center justify-center rounded-full px-1.5 min-w-[18px] h-[18px] text-[10px] font-bold leading-none bg-muted-foreground/15 text-muted-foreground">
              {entries.length}
            </span>
          ) : null}
        </span>

        <span className="flex items-center gap-1.5 flex-shrink-0">
          {last ? (
            <span className="text-[11px] text-muted-foreground/80">
              אחרונה {hebrewTimeAgo(last.created_date)}
            </span>
          ) : null}
          {onAddCommunication ? (
            <button
              type="button"
              onClick={onAddCommunication}
              className="h-7 w-7 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground grid place-items-center"
              title="הוסף תקשורת"
              aria-label="הוסף תקשורת"
            >
              <Plus className="h-4 w-4" />
            </button>
          ) : null}
        </span>
      </div>

      {isLoading ? (
        <p className="px-4 pb-4 m-0 text-xs text-muted-foreground">טוען…</p>
      ) : entries.length === 0 ? (
        <div className="px-4 pb-4">
          <div className="rounded-xl bg-muted/50 px-4 py-5 text-center">
            <p className="text-sm text-muted-foreground m-0">עוד לא תועדה שיחה עם הלקוח.</p>
            {onAddCommunication ? (
              <Button variant="outline" size="sm" className="mt-3 h-8 gap-1.5 bg-card" onClick={onAddCommunication}>
                <Plus className="h-3.5 w-3.5" />
                הוסף תקשורת
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        /* Bounded and scrolled inside its own box: a lead worked for two months
           can carry dozens of calls, and the card is a fact about the lead, not
           the page. */
        <ul className="list-none m-0 p-0 max-h-[264px] overflow-y-auto">
          {entries.map((entry) => {
            const { label, icon: Icon, tone } = entryVisual(entry);
            const direction = DIRECTION_LABELS[entry.direction] || '';
            const when = entry.created_date
              ? formatInTimeZone(entry.created_date, 'Asia/Jerusalem', 'dd/MM/yyyy HH:mm')
              : '';
            const duration = entry.duration_seconds ? formatCallDuration(entry.duration_seconds) : '';
            const rep = entry.rep_id ? getRepDisplayName(entry.rep_id, users) : '';
            // The one line of context under the header: what the rep wrote if
            // they wrote anything, otherwise who handled it.
            const secondary = String(entry.subject || entry.content || '').trim() || rep;

            return (
              <li key={entry.logKey} className="border-t border-border/50 first:border-t-0 px-4 py-2.5">
                <div className="flex items-start gap-2.5">
                  <span className={`h-7 w-7 rounded-full grid place-items-center flex-none ${tone}`}>
                    <Icon className="h-3.5 w-3.5" />
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap text-[13px]">
                      <span className="font-medium">{direction ? `${label} ${direction}` : label}</span>
                      {when ? <span className="text-muted-foreground/70 tabular-nums">{when}</span> : null}
                      {duration ? (
                        <span className="text-muted-foreground/70 tabular-nums">· {duration}</span>
                      ) : null}
                    </div>
                    {secondary ? (
                      <p className="m-0 mt-0.5 text-[11px] text-muted-foreground/70 truncate" title={secondary}>
                        {secondary}
                      </p>
                    ) : null}
                  </div>

                  {entry.outcome ? (
                    <StatusBadge
                      status={entry.outcome}
                      label={contactOutcomeLabel(entry.outcome)}
                      className="flex-none"
                    />
                  ) : null}
                </div>

                {entry.recording_url ? (
                  <div className="mt-1.5 ps-9">
                    <RecordingPlayer recordingUrl={entry.recording_url} hasRecording />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
