import React, { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Loader2, Save, Eye, EyeOff, Send, CheckCircle2, AlertTriangle, KeyRound } from 'lucide-react';

// Admin-only settings for the 019 (019sms.co.il) SMS account. The token is a
// secret, so it's stored server-side (sms_settings table, RLS-locked) and we
// only ever talk to the `smsSettings` Edge Function — the browser receives a
// masked hint (••••1234), never the raw token.
const SOURCE_LABELS = {
  db: 'מוגדר מתוך מסך זה',
  env: 'מוגדר דרך משתני סביבה (Supabase)',
  none: 'לא מוגדר',
};

export default function Sms019SettingsTab() {
  const queryClient = useQueryClient();

  const { data: status, isLoading, isError, error } = useQuery({
    queryKey: ['sms-settings'],
    queryFn: async () => base44.functions.invoke('smsSettings', { action: 'get' }),
    retry: false,
  });

  const [draft, setDraft] = useState({ username: '', sender: '', token: '' });
  const [showToken, setShowToken] = useState(false);
  const [testPhone, setTestPhone] = useState('');

  useEffect(() => {
    if (status) {
      setDraft({ username: status.username || '', sender: status.sender || 'KingDavid', token: '' });
    }
  }, [status]);

  const saveMutation = useMutation({
    mutationFn: async () => base44.functions.invoke('smsSettings', {
      action: 'save',
      username: draft.username,
      sender: draft.sender,
      token: draft.token, // blank = keep existing token
    }),
    onSuccess: () => {
      toast.success('פרטי 019 נשמרו');
      setDraft((d) => ({ ...d, token: '' }));
      setShowToken(false);
      queryClient.invalidateQueries({ queryKey: ['sms-settings'] });
    },
    onError: (err) => toast.error(`שמירה נכשלה: ${err?.message || 'שגיאה'}`),
  });

  const testMutation = useMutation({
    mutationFn: async () => base44.functions.invoke('smsSettings', {
      action: 'test',
      phone: testPhone,
    }),
    onSuccess: (res) => {
      if (res?.ok) toast.success('הודעת בדיקה נשלחה בהצלחה ✅');
      else if (res?.configured === false) toast.error('החשבון עדיין לא מוגדר — שמור טוקן ושם משתמש קודם');
      else toast.error('שליחת הבדיקה נכשלה');
    },
    onError: (err) => toast.error(`שליחת הבדיקה נכשלה: ${err?.message || 'שגיאה'}`),
  });

  const Logo = (
    <img src="/sms-019-logo.svg" alt="019 SMS" className="h-10 w-auto" />
  );

  if (isLoading) {
    return (
      <Card>
        <CardHeader><div className="flex items-center gap-3">{Logo}<CardTitle className="text-base">שליחת SMS — 019</CardTitle></div></CardHeader>
        <CardContent><div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div></CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardHeader><div className="flex items-center gap-3">{Logo}<CardTitle className="text-base">שליחת SMS — 019</CardTitle></div></CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">
            לא ניתן לטעון את הגדרות ה-SMS מהשרת. ייתכן שהפונקציה <code>smsSettings</code> או טבלת ההגדרות עדיין לא נפרסו. נסה שוב בעוד כמה דקות.
          </p>
          <p className="text-xs text-muted-foreground mt-2">{error?.message}</p>
        </CardContent>
      </Card>
    );
  }

  const configured = status?.configured;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          {Logo}
          <div>
            <CardTitle className="text-base">שליחת SMS — 019</CardTitle>
            <CardDescription>חיבור חשבון 019sms לשליחת הודעות SMS מהמערכת</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Connection status */}
        {configured ? (
          <div className="p-3 bg-green-50 border border-green-200 rounded-lg flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-green-800 space-y-0.5">
              <p className="font-medium">החשבון מחובר ומוכן לשליחה</p>
              <p className="text-xs text-green-700">
                {SOURCE_LABELS[status.source] || status.source}
                {status.sender ? ` · שולח: ${status.sender}` : ''}
                {status.token_hint ? ` · טוקן: ${status.token_hint}` : ''}
              </p>
              {status.updated_date ? (
                <p className="text-[11px] text-green-700/80">
                  עודכן: {new Date(status.updated_date).toLocaleString('he-IL')}{status.updated_by ? ` · ${status.updated_by}` : ''}
                </p>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-yellow-600 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-yellow-800">
              <p className="font-medium">החשבון עדיין לא מוגדר</p>
              <p className="text-xs text-yellow-700">הזן את שם המשתמש, שם השולח והטוקן של חשבון 019 ולחץ "שמור".</p>
            </div>
          </div>
        )}

        {/* Credentials form */}
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="sms019-username">שם משתמש 019</Label>
            <Input
              id="sms019-username"
              value={draft.username}
              onChange={(e) => setDraft({ ...draft, username: e.target.value })}
              placeholder="שם המשתמש של חשבון 019"
              dir="ltr"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="sms019-sender">שם השולח (Sender ID)</Label>
            <Input
              id="sms019-sender"
              value={draft.sender}
              onChange={(e) => setDraft({ ...draft, sender: e.target.value })}
              placeholder="KingDavid"
              dir="ltr"
            />
            <p className="text-[11px] text-muted-foreground">
              השם שיופיע לנמען. יש לאשר אותו מראש מול 019 (אותיות באנגלית או מספר טלפון).
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="sms019-token">API Token</Label>
            <div className="relative">
              <Input
                id="sms019-token"
                type={showToken ? 'text' : 'password'}
                value={draft.token}
                onChange={(e) => setDraft({ ...draft, token: e.target.value })}
                placeholder={status?.token_set ? `שמור (${status.token_hint}) — השאר ריק כדי לא לשנות` : 'הדבק כאן את הטוקן מ-019'}
                dir="ltr"
                className="pe-10"
                autoComplete="off"
              />
              <button
                type="button"
                onClick={() => setShowToken((v) => !v)}
                className="absolute inset-y-0 end-0 flex items-center pe-3 text-muted-foreground hover:text-foreground"
                aria-label={showToken ? 'הסתר טוקן' : 'הצג טוקן'}
              >
                {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground flex items-center gap-1">
              <KeyRound className="h-3 w-3" />
              להפקת טוקן: התחבר ל-019 ← הגדרות ← "ניהול טוקן API". הטוקן נשמר מוצפן בצד השרת ולא נחשף שוב.
            </p>
          </div>

          <Button type="button" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !draft.username.trim()}>
            {saveMutation.isPending ? <Loader2 className="h-4 w-4 me-2 animate-spin" /> : <Save className="h-4 w-4 me-2" />}
            שמור
          </Button>
        </div>

        {/* Test send */}
        <div className="border-t border-border/50 pt-4 space-y-2">
          <Label htmlFor="sms019-test">בדיקת שליחה</Label>
          <div className="flex gap-2">
            <Input
              id="sms019-test"
              value={testPhone}
              onChange={(e) => setTestPhone(e.target.value)}
              placeholder="מספר טלפון לבדיקה (05X-XXXXXXX)"
              dir="ltr"
              className="flex-1"
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => testMutation.mutate()}
              disabled={testMutation.isPending || !testPhone.trim() || !configured}
            >
              {testMutation.isPending ? <Loader2 className="h-4 w-4 me-2 animate-spin" /> : <Send className="h-4 w-4 me-2" />}
              שלח בדיקה
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            תישלח הודעת SMS אמיתית למספר שהוזן (נספרת בחיוב מול 019).
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
