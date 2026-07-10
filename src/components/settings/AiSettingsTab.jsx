import React, { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Loader2, Save, RefreshCw, Sparkles, AlertTriangle, CheckCircle2 } from 'lucide-react';

// USD price per token (as returned by OpenRouter) → USD per 1M tokens, 2dp.
function per1M(n) {
  return (Number(n || 0) * 1_000_000).toFixed(2);
}

function ModelOption({ m }) {
  return (
    <SelectItem key={m.id} value={m.id}>
      <span dir="ltr">{m.name}</span>
      <span className="text-muted-foreground"> — ${per1M(m.prompt_price)}/${per1M(m.completion_price)} ל-1M טוקנים (קלט/פלט)</span>
    </SelectItem>
  );
}

// Lets an admin pick which model (via OpenRouter) powers every "נסח עם AI"
// style feature in the app — currently the WhatsApp template composer
// (WhatsAppTemplatesTab). The model list is fetched live from OpenRouter's
// public catalog (through invokeLLM's action:'list_models' proxy, so no key
// reaches the browser), sorted cheapest-first, with a separate "smart /
// flagship" group the server tags by name-matching against known model
// families — see SMART_MODEL_HINTS in supabase/functions/invokeLLM.
export default function AiSettingsTab() {
  const queryClient = useQueryClient();

  const { data: row, isLoading: rowLoading, isError: rowError, error: rowErrorObj } = useQuery({
    queryKey: ['ai-settings'],
    queryFn: async () => {
      const rows = await base44.entities.AiSettings.list();
      return rows[0] || null;
    },
    retry: false,
  });

  const {
    data: catalog, isLoading: catalogLoading, isError: catalogError,
    refetch: refetchCatalog, isFetching: catalogFetching,
  } = useQuery({
    queryKey: ['ai-models-catalog'],
    queryFn: () => base44.functions.invoke('invokeLLM', { action: 'list_models' }),
    staleTime: 30 * 60 * 1000,
    retry: false,
  });

  const [model, setModel] = useState('');
  useEffect(() => {
    if (row?.model) setModel(row.model);
  }, [row]);

  const saveMutation = useMutation({
    mutationFn: () => base44.entities.AiSettings.update(1, { model, provider: 'openrouter' }),
    onSuccess: () => {
      toast.success('מודל ה-AI עודכן');
      queryClient.invalidateQueries({ queryKey: ['ai-settings'] });
    },
    onError: (err) => toast.error(`שמירה נכשלה: ${err?.message || 'שגיאה'}`),
  });

  if (rowLoading) {
    return <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  if (rowError) {
    return (
      <Card>
        <CardHeader><CardTitle>בינה מלאכותית</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">
            לא ניתן לטעון את הגדרות ה-AI מהשרת. ייתכן שה-migration של ai_settings עדיין לא הופעל. נסה שוב בעוד כמה דקות.
          </p>
          <p className="text-xs text-muted-foreground mt-2">{rowErrorObj?.message}</p>
        </CardContent>
      </Card>
    );
  }

  const recommended = catalog?.recommended || [];
  const cheapest = (catalog?.cheapest || []).filter((c) => !recommended.some((r) => r.id === c.id));
  const knownModel = model && (recommended.some((m) => m.id === model) || cheapest.some((m) => m.id === model));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4" />בינה מלאכותית</CardTitle>
        <CardDescription>
          המודל שמריץ את פיצ'רי "נסח עם AI" בכל המערכת (כרגע: תבניות וואטסאפ בהגדרות), דרך OpenRouter.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {catalogLoading ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : catalogError ? (
          <div className="p-3 bg-destructive/5 border border-destructive/30 rounded-lg text-sm text-destructive">
            לא ניתן לטעון את רשימת המודלים מ-OpenRouter כרגע. נסה לרענן, או שהפונקציה invokeLLM עדיין לא עודכנה בשרת.
          </div>
        ) : (
          <>
            <div className={`p-3 rounded-lg border flex items-start gap-2 ${catalog?.openrouter_configured ? 'bg-green-50 border-green-200' : 'bg-yellow-50 border-yellow-200'}`}>
              {catalog?.openrouter_configured
                ? <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
                : <AlertTriangle className="h-4 w-4 text-yellow-600 mt-0.5 shrink-0" />}
              <p className="text-xs">
                {catalog?.openrouter_configured
                  ? 'מחובר ל-OpenRouter — הבחירה למטה פעילה בפועל.'
                  : 'OpenRouter עדיין לא מחובר בשרת (חסר OPENROUTER_API_KEY בפונקציות Supabase). אפשר לבחור מודל מראש — עד לחיבור, "נסח עם AI" ימשיך לעבוד עם Claude/OpenAI הישירים הקיימים.'}
              </p>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>מודל</Label>
                <Button
                  variant="ghost" size="sm" className="h-7 text-xs gap-1"
                  onClick={() => refetchCatalog()}
                  disabled={catalogFetching}
                >
                  {catalogFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  רענן רשימה
                </Button>
              </div>
              <Select value={model} onValueChange={setModel} dir="rtl">
                <SelectTrigger><SelectValue placeholder="בחר מודל" /></SelectTrigger>
                <SelectContent>
                  {!knownModel && model && (
                    <SelectGroup>
                      <SelectLabel>נוכחי</SelectLabel>
                      <SelectItem value={model}><span dir="ltr">{model}</span></SelectItem>
                    </SelectGroup>
                  )}
                  {recommended.length > 0 && (
                    <SelectGroup>
                      <SelectLabel>🧠 חכמים ומומלצים</SelectLabel>
                      {recommended.map((m) => <ModelOption key={m.id} m={m} />)}
                    </SelectGroup>
                  )}
                  {cheapest.length > 0 && (
                    <SelectGroup>
                      <SelectLabel>💰 הכי זולים</SelectLabel>
                      {cheapest.map((m) => <ModelOption key={m.id} m={m} />)}
                    </SelectGroup>
                  )}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                המחירים לפי OpenRouter, לכל מיליון טוקנים. "מומלצים" הם מודלים מוכרים כחזקים (לא בהכרח הכי זולים); "הכי זולים" ממוינים לפי מחיר עולה.
              </p>
            </div>
          </>
        )}

        <div className="flex items-center gap-3 pt-2">
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !model}>
            {saveMutation.isPending ? <Loader2 className="h-4 w-4 me-2 animate-spin" /> : <Save className="h-4 w-4 me-2" />}
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
