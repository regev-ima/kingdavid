import React, { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Loader2, Save, RotateCcw } from 'lucide-react';
import useEffectiveCurrentUser from '@/hooks/use-effective-current-user';
import {
  DEFAULT_DOCUMENT_TERMS,
  DOCUMENT_TERMS_FIELDS,
  resolveDocumentTerms,
} from '@/constants/documentTerms';
import {
  DOCUMENT_TERMS_QUERY_KEY,
  fetchDocumentTermsSetting,
  saveDocumentTermsSetting,
} from '@/lib/documentTermsSettings';

// A save that fails because the table isn't there yet is the one error worth
// naming precisely — the migration is applied by hand in Supabase.
const MISSING_TABLE = /app_settings|PGRST205|does not exist|schema cache/i;

export default function DocumentTermsTab() {
  const queryClient = useQueryClient();
  const { effectiveUser } = useEffectiveCurrentUser();

  const { data, isLoading } = useQuery({
    queryKey: DOCUMENT_TERMS_QUERY_KEY,
    queryFn: fetchDocumentTermsSetting,
    retry: false,
  });

  // Seeded once, from whatever is in effect right now (stored row, else the
  // text in code). A background refetch must not throw away a draft.
  const [draft, setDraft] = useState(null);
  useEffect(() => {
    if (isLoading || draft !== null) return;
    setDraft(resolveDocumentTerms(data?.value, null));
  }, [data, isLoading, draft]);

  const saveMutation = useMutation({
    mutationFn: () => saveDocumentTermsSetting(draft, effectiveUser?.email),
    onSuccess: () => {
      toast.success('הטקסטים נשמרו');
      queryClient.invalidateQueries({ queryKey: DOCUMENT_TERMS_QUERY_KEY });
    },
    onError: (err) => {
      const detail = err?.message || err?.details || 'שגיאה';
      if (MISSING_TABLE.test(detail)) {
        toast.error('טבלת app_settings לא קיימת עדיין — יש להריץ את המיגרציה ב-Supabase. עד אז מוצגים הטקסטים שבקוד.', {
          duration: 12000,
        });
        return;
      }
      toast.error(`שמירה נכשלה: ${detail}`, { duration: 10000 });
    },
  });

  if (isLoading || draft === null) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const isDirty = DOCUMENT_TERMS_FIELDS.some((f) => draft[f.key] !== resolveDocumentTerms(data?.value, null)[f.key]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>טקסטים ותנאים</CardTitle>
        <CardDescription>
          הנוסח המשפטי שמופיע על הצעות מחיר והזמנות — במסך המסמך וב-PDF.
          שינוי כאן חל על כל המסמכים שמשתמשים בנוסח הסטנדרטי, כולל קיימים.
          מסמך שבו הנציג כתב נוסח משלו שומר את הנוסח שלו ולא מושפע מכאן.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {!data && (
          <p className="text-xs text-muted-foreground bg-muted/50 rounded-md px-3 py-2">
            כרגע מוצגים טקסטי ברירת המחדל שבקוד — עדיין לא נשמר נוסח מותאם.
          </p>
        )}

        {DOCUMENT_TERMS_FIELDS.map((field) => (
          <div key={field.key} className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor={`dt-${field.key}`}>{field.label}</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-muted-foreground"
                disabled={draft[field.key] === DEFAULT_DOCUMENT_TERMS[field.key]}
                onClick={() => setDraft({ ...draft, [field.key]: DEFAULT_DOCUMENT_TERMS[field.key] })}
              >
                <RotateCcw className="h-3 w-3 me-1" />
                שחזור לברירת מחדל
              </Button>
            </div>
            <Textarea
              id={`dt-${field.key}`}
              value={draft[field.key]}
              onChange={(e) => setDraft({ ...draft, [field.key]: e.target.value })}
              rows={field.rows}
              className="font-mono text-[13px]"
            />
          </div>
        ))}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !isDirty}>
            {saveMutation.isPending ? (
              <Loader2 className="h-4 w-4 me-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 me-2" />
            )}
            שמור
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setDraft({ ...DEFAULT_DOCUMENT_TERMS })}
            disabled={DOCUMENT_TERMS_FIELDS.every((f) => draft[f.key] === DEFAULT_DOCUMENT_TERMS[f.key])}
          >
            <RotateCcw className="h-4 w-4 me-2" />
            שחזור הכל
          </Button>
          {data?.updated_date && (
            <span className="text-xs text-muted-foreground">
              עודכן לאחרונה: {new Date(data.updated_date).toLocaleString('he-IL')}
              {data.updated_by ? ` · ${data.updated_by}` : ''}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
