import React, { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Loader2, Save, Check } from 'lucide-react';
import { PAYMENT_TERMS_OPTIONS } from '@/constants/paymentTerms';

export default function QuoteDefaultsTab() {
  const queryClient = useQueryClient();
  const { data: row, isLoading } = useQuery({
    queryKey: ['quote-defaults'],
    queryFn: async () => {
      const rows = await base44.entities.QuoteDefaults.list();
      return rows[0] || null;
    },
  });

  const [draft, setDraft] = useState({ terms: '', notes: '', payment_terms_selection: [] });

  useEffect(() => {
    if (row) {
      setDraft({
        terms: row.terms || '',
        notes: row.notes || '',
        payment_terms_selection: Array.isArray(row.payment_terms_selection) ? row.payment_terms_selection : [],
      });
    }
  }, [row]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      await base44.entities.QuoteDefaults.update(1, {
        terms: draft.terms,
        notes: draft.notes,
        payment_terms_selection: draft.payment_terms_selection,
      });
    },
    onSuccess: () => {
      toast.success('ברירות-המחדל נשמרו');
      queryClient.invalidateQueries({ queryKey: ['quote-defaults'] });
    },
    onError: (err) => {
      toast.error(`שמירה נכשלה: ${err?.message || 'שגיאה'}`);
    },
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>ברירות-מחדל להצעה</CardTitle>
        <CardDescription>
          הטקסטים והאפשרויות שיופיעו אוטומטית בכל הצעה חדשה. נציגים עדיין יכולים לערוך אותם פר-הצעה.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="qd-terms">תנאי תשלום ואספקה</Label>
          <Textarea
            id="qd-terms"
            value={draft.terms}
            onChange={(e) => setDraft({ ...draft, terms: e.target.value })}
            rows={3}
            className="resize-none"
          />
        </div>

        <div className="space-y-2">
          <Label>אמצעי תשלום</Label>
          <p className="text-[11px] text-muted-foreground">ייבחרו אוטומטית בכל הצעה חדשה. ניתן להוסיף/להסיר.</p>
          <div className="flex flex-wrap gap-2">
            {PAYMENT_TERMS_OPTIONS.map((opt) => {
              const selected = draft.payment_terms_selection.includes(opt);
              return (
                <Button
                  key={opt}
                  type="button"
                  variant={selected ? 'default' : 'outline'}
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => {
                    setDraft({
                      ...draft,
                      payment_terms_selection: selected
                        ? draft.payment_terms_selection.filter((x) => x !== opt)
                        : [...draft.payment_terms_selection, opt],
                    });
                  }}
                >
                  {selected && <Check className="h-3 w-3 me-1" />}
                  {opt}
                </Button>
              );
            })}
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="qd-notes">הערות</Label>
          <Textarea
            id="qd-notes"
            value={draft.notes}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            rows={14}
            className="font-mono text-[13px]"
          />
        </div>

        <div className="flex items-center gap-3">
          <Button
            type="button"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? (
              <Loader2 className="h-4 w-4 me-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 me-2" />
            )}
            שמור
          </Button>
          {row?.updated_date && (
            <span className="text-xs text-muted-foreground">
              עודכן לאחרונה: {new Date(row.updated_date).toLocaleString('he-IL')}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
