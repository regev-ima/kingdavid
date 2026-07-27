import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
  LEAD_VISIBILITY_ALL,
  LEAD_VISIBILITY_OWN,
  hydrateLeadVisibility,
} from '@/lib/leadVisibility';
import {
  useLeadVisibilityPolicy,
  LEAD_VISIBILITY_QUERY_KEY,
} from '@/hooks/useLeadVisibilityPolicy';

const OPTIONS = [
  {
    value: LEAD_VISIBILITY_ALL,
    label: 'כולם רואים הכל',
    desc: 'כל נציג מכירות רואה את כל הלידים במערכת — חדשים, ישנים, ושל נציגים אחרים.',
    icon: 'groups',
  },
  {
    value: LEAD_VISIBILITY_OWN,
    label: 'כל אחד רק את שלו',
    desc: 'נציג רואה רק לידים שבהם הוא נציג ראשי, נציג משני, או ממתין לשיוך אליו.',
    icon: 'person',
  },
];

export default function LeadVisibilityTab() {
  const policy = useLeadVisibilityPolicy();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState(policy);

  // Follow the server value when it arrives or changes elsewhere, but only
  // while there is nothing to save — otherwise a refetch mid-edit would
  // silently throw away the admin's unsaved choice.
  useEffect(() => {
    setSelected((current) => (current === policy ? current : policy));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [policy]);

  const dirty = selected !== policy;

  const saveMutation = useMutation({
    mutationFn: async () => {
      await base44.entities.AppPolicy.update(1, {
        lead_visibility: selected,
        updated_date: new Date().toISOString(),
      });
      return selected;
    },
    onSuccess: (value) => {
      // Update the synchronous cache immediately so predicates that do not go
      // through the hook agree with the screen before any refetch lands.
      hydrateLeadVisibility(value);
      queryClient.invalidateQueries({ queryKey: LEAD_VISIBILITY_QUERY_KEY });
      // The leads list and its counts have to be refetched — otherwise the
      // policy changes and the screen keeps serving rows from the old cache.
      // leadMgmt-leads / -count are keyed on the built query object, which
      // already changes with the switch; they are invalidated anyway so an
      // admin who is sitting on the leads screen sees the effect immediately
      // rather than at the next natural refetch.
      queryClient.invalidateQueries({ queryKey: ['leadMgmt-leads'] });
      queryClient.invalidateQueries({ queryKey: ['leadMgmt-count'] });
      queryClient.invalidateQueries({ queryKey: ['leadMgmt-kpis'] });
      queryClient.invalidateQueries({ queryKey: ['leadMgmt-handling-breakdown'] });
      toast.success('הרשאות הצפייה נשמרו');
    },
    onError: (err) => {
      toast.error(err?.message || 'שמירת ההרשאות נכשלה');
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>הרשאות צפייה בלידים</CardTitle>
        <CardDescription>
          קובע מה נציג מכירות רואה כברירת מחדל. מנהלים רואים תמיד את כל הלידים
          ואינם מושפעים מההגדרה הזו.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {OPTIONS.map((opt) => {
            const active = selected === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setSelected(opt.value)}
                aria-pressed={active}
                className={`text-right rounded-xl border p-4 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                  active
                    ? 'border-primary bg-primary/5 shadow-card'
                    : 'border-border bg-card hover:border-primary/50'
                }`}
              >
                <span
                  className={`material-symbols-outlined mb-2 inline-flex h-10 w-10 items-center justify-center rounded-xl ${
                    active ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'
                  }`}
                  style={{ fontSize: '22px' }}
                  aria-hidden="true"
                >
                  {opt.icon}
                </span>
                <p className="font-semibold text-foreground">{opt.label}</p>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{opt.desc}</p>
              </button>
            );
          })}
        </div>

        <p className="text-xs text-muted-foreground leading-relaxed">
          גם כאשר נבחר <span className="font-medium">״כל אחד רק את שלו״</span>, ניתן
          לפתוח את כל הלידים לנציג מסוים דרך <span className="font-medium">נהל נציג ← הרשאות</span>.
          הרשאה פרטנית תמיד מרחיבה ולעולם אינה מצמצמת.
        </p>

        <div className="flex items-center gap-3 pt-1">
          <Button onClick={() => saveMutation.mutate()} disabled={!dirty || saveMutation.isPending}>
            {saveMutation.isPending ? 'שומר…' : 'שמירה'}
          </Button>
          {dirty ? (
            <Button variant="ghost" onClick={() => setSelected(policy)} disabled={saveMutation.isPending}>
              ביטול
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
