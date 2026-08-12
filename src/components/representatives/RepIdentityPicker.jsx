import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Sparkles } from 'lucide-react';
import { REP_COLORS, REP_ICONS, identityOwners } from '@/lib/repIdentity';

/**
 * Is `users.avatar_color` there yet? It arrives with a migration, and a deploy
 * can briefly land ahead of it. Probing once means the picker simply doesn't
 * appear until the column exists, instead of offering a choice whose save would
 * fail and take the rep's name and phone down with it. Same graceful-degradation
 * shape the leads screen uses for its own new DB objects.
 */
export function useAvatarIdentitySupported() {
  const { data = false } = useQuery({
    queryKey: ['userAvatarColorSupported'],
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    queryFn: async () => {
      const { error } = await base44.supabase.from('users').select('avatar_color').limit(1);
      if (error) {
        console.warn('[reps] avatar_color unavailable:', error.message);
        return false;
      }
      return true;
    },
  });
  return data;
}

// One row of choices — colours or icons. Whatever another rep already holds is
// disabled and says whose it is: the uniqueness the whole feature rests on is
// enforced here, in the one place a person could break it, rather than left to
// whoever is picking to remember.
function ChoiceGrid({ title, hint, entries, owners, myEmail, selected, onSelect, onClear, render }) {
  const mine = useMemo(() => {
    for (const [id, owner] of owners.entries()) {
      if (String(owner.email || '').trim().toLowerCase() === myEmail) return id;
    }
    return null;
  }, [owners, myEmail]);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs">
          {title}
          <span className="ms-1.5 font-normal text-muted-foreground">{hint}</span>
        </Label>
        <Button
          type="button"
          variant={selected === null ? 'secondary' : 'ghost'}
          size="sm"
          className="h-6 gap-1 px-2 text-[11px]"
          onClick={onClear}
          title="בחירה אוטומטית"
        >
          <Sparkles className="h-3 w-3" />
          אוטומטי
        </Button>
      </div>
      <div className="flex flex-wrap gap-1.5 rounded-xl border border-border p-2">
        {entries.map((entry) => {
          const owner = owners.get(entry.id);
          const isMine = mine === entry.id;
          const takenByOther = !!owner && !isMine;
          const isSelected = selected === entry.id;
          const title2 = takenByOther
            ? `תפוס — ${owner.full_name}`
            : isMine && selected === null
              ? `${entry.label || entry.id} · משויך אוטומטית`
              : (entry.label || entry.id);
          return (
            <button
              key={entry.id}
              type="button"
              disabled={takenByOther}
              onClick={() => onSelect(entry.id)}
              title={title2}
              aria-label={title2}
              aria-pressed={isSelected}
              className={`h-8 w-8 rounded-lg flex items-center justify-center text-base transition-all ${
                isSelected
                  ? 'ring-2 ring-primary ring-offset-1 scale-110'
                  : takenByOther
                    // Faded, but still legible — a pastel at opacity-20 reads as
                    // an empty square, which makes the grid look half-missing
                    // rather than half-taken.
                    ? 'opacity-40 grayscale cursor-not-allowed'
                    : 'hover:scale-110'
              }`}
            >
              {render(entry)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Pick the colour and the icon a rep is shown with everywhere in the app —
 * two independent choices, because deciding someone should be 🦊 says nothing
 * about what colour they ought to be.
 *
 * "אוטומטי" on either row hands that half back to the automatic assignment,
 * which is where everyone starts.
 */
export default function RepIdentityPicker({ rep, colorId, iconId, onChange }) {
  const supported = useAvatarIdentitySupported();
  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => base44.entities.User.list(),
    staleTime: 5 * 60_000,
  });

  const owners = useMemo(() => identityOwners(users), [users]);
  const myEmail = String(rep?.email || '').trim().toLowerCase();

  if (!supported) return null;

  return (
    <div className="space-y-3 rounded-xl border border-border p-3">
      <p className="text-sm font-medium">
        צבע ואייקון
        <span className="ms-1.5 text-[11px] font-normal text-muted-foreground">
          — מזהים את הנציג בכל מסך במערכת
        </span>
      </p>

      <ChoiceGrid
        title="צבע"
        hint="— גוונים פסטליים"
        entries={REP_COLORS}
        owners={owners.colors}
        myEmail={myEmail}
        selected={colorId}
        onSelect={(id) => onChange({ colorId: id, iconId })}
        onClear={() => onChange({ colorId: null, iconId })}
        render={(entry) => (
          // A ring on every swatch so the pale end of the palette still reads
          // as a chip rather than as a gap in the row.
          <span className={`h-full w-full rounded-lg ring-1 ring-black/10 ${entry.chip}`} />
        )}
      />

      <ChoiceGrid
        title="אייקון"
        hint="— כל האייקונים הזמינים"
        entries={REP_ICONS}
        owners={owners.icons}
        myEmail={myEmail}
        selected={iconId}
        onSelect={(id) => onChange({ colorId, iconId: id })}
        onClear={() => onChange({ colorId, iconId: null })}
        render={(entry) => entry.emoji}
      />

      <p className="text-[11px] text-muted-foreground">
        אפשרויות מעומעמות כבר תפוסות על ידי נציג אחר — כל נציג מקבל צבע ואייקון משלו.
      </p>
    </div>
  );
}
