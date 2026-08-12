import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Sparkles } from 'lucide-react';
import { REP_PALETTE, slotOwners } from '@/lib/repIdentity';

/**
 * Pick the colour + icon a rep is shown with everywhere in the app.
 *
 * Every slot in the palette is a colour AND an icon that no other slot has, so
 * picking one is a single choice rather than two that can clash. Slots another
 * rep already occupies are disabled and say whose they are — the uniqueness the
 * whole feature rests on is enforced here, in the one place a person could
 * break it, rather than left to whoever is picking to remember.
 *
 * "אוטומטי" clears the pin and hands the rep back to the automatic assignment,
 * which is where everyone starts.
 */
/**
 * Is `users.avatar_slot` there yet? It arrives with a migration, and a deploy
 * can briefly land ahead of it. Probing once means the picker simply doesn't
 * appear until the column exists, instead of offering a choice whose save would
 * fail and take the rep's name and phone down with it. Same graceful-degradation
 * shape the leads screen uses for its own new DB objects.
 */
export function useAvatarSlotSupported() {
  const { data = false } = useQuery({
    queryKey: ['userAvatarSlotSupported'],
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    queryFn: async () => {
      const { error } = await base44.supabase.from('users').select('avatar_slot').limit(1);
      if (error) {
        console.warn('[reps] avatar_slot unavailable:', error.message);
        return false;
      }
      return true;
    },
  });
  return data;
}

export default function RepIdentityPicker({ rep, value, onChange }) {
  const supported = useAvatarSlotSupported();
  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => base44.entities.User.list(),
    staleTime: 5 * 60_000,
  });

  const owners = useMemo(() => slotOwners(users), [users]);
  const myEmail = String(rep?.email || '').trim().toLowerCase();

  // The slot this rep sits in right now — pinned, or the one the automatic
  // assignment gave them. Marking it keeps the grid honest: without it, a rep
  // on an auto slot would see their own current identity greyed out as "taken".
  const mySlot = useMemo(() => {
    for (const [slot, owner] of owners.entries()) {
      if (String(owner.email || '').trim().toLowerCase() === myEmail) return slot;
    }
    return null;
  }, [owners, myEmail]);

  const selected = Number.isInteger(value) ? value : null;

  if (!supported) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label className="flex items-center gap-1.5">
          צבע ואייקון
          <span className="text-[11px] font-normal text-muted-foreground">
            — מזהה את הנציג בכל מסך במערכת
          </span>
        </Label>
        <Button
          type="button"
          variant={selected === null ? 'secondary' : 'ghost'}
          size="sm"
          className="h-7 gap-1 text-xs"
          onClick={() => onChange(null)}
          title="החזרת הנציג לשיוך האוטומטי"
        >
          <Sparkles className="h-3.5 w-3.5" />
          אוטומטי
        </Button>
      </div>

      <div className="grid grid-cols-9 gap-1.5 rounded-xl border border-border p-2.5">
        {REP_PALETTE.map((entry, slot) => {
          const owner = owners.get(slot);
          const isMine = mySlot === slot;
          const takenByOther = !!owner && !isMine;
          const isSelected = selected === slot;
          const title = takenByOther
            ? `תפוס — ${owner.full_name}`
            : isMine && selected === null
              ? `${entry.emoji} · משויך אוטומטית`
              : entry.emoji;
          return (
            <button
              key={entry.id}
              type="button"
              disabled={takenByOther}
              onClick={() => onChange(slot)}
              title={title}
              aria-label={title}
              aria-pressed={isSelected}
              className={`relative h-9 rounded-lg flex items-center justify-center text-base transition-all ${entry.chip} ${
                isSelected
                  ? 'ring-2 ring-primary ring-offset-1 scale-105'
                  : takenByOther
                    ? 'opacity-25 cursor-not-allowed'
                    : 'hover:scale-105 hover:brightness-95'
              }`}
            >
              {entry.emoji}
            </button>
          );
        })}
      </div>

      <p className="text-[11px] text-muted-foreground">
        {selected === null
          ? 'משויך אוטומטית — הנציג מקבל את המשבצת הפנויה הבאה. בחר משבצת כדי לקבע אותה.'
          : 'משבצת מקובעת. משבצות מעומעמות כבר תפוסות על ידי נציג אחר.'}
      </p>
    </div>
  );
}
