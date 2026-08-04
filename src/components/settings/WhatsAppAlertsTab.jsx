import React, { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Loader2, Save, Send, RefreshCw, CheckCircle2, AlertTriangle, BellOff, Bell, Users, Zap,
} from 'lucide-react';

// Admin settings for the "a rep's WhatsApp disconnected" alert.
//
// How it works, so the screen isn't a mystery: Green API pushes
// stateInstanceChanged the moment a rep's phone unlinks, greenApiWebhook
// catches it, and one message goes out to the group below — through the
// nominated rep's own WhatsApp number (which is why that number has to be a
// member of the group). A scheduled sweep re-checks every instance as a
// backstop in case the webhook never arrives.
//
// Everything here goes through the greenApiSettings Edge Function: the config
// table holds the sweep's auth token, so no client reads it directly.

function relTime(iso) {
  if (!iso) return '—';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'עכשיו';
  if (mins < 60) return `לפני ${mins} דק׳`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `לפני ${hours} ש׳`;
  return new Date(iso).toLocaleDateString('he-IL');
}

const LOG_KIND_LABELS = {
  disconnected: 'ניתוק',
  recovered: 'חזרה לפעול',
  test: 'בדיקה',
};

// The server returns machine-readable reasons; a manager needs the "so what".
const ERROR_LABELS = {
  notifier_not_set: 'לא נבחר נציג שולח',
  notifier_not_configured: 'לנציג השולח אין חיבור Green API',
  group_chat_id_missing: 'לא הוגדרה קבוצה',
  group_lookup_failed: 'לא נמצאה קבוצה עם המזהה הזה (או שהנציג השולח אינו חבר בה)',
  not_a_group_id: 'המזהה אינו מזהה קבוצה',
  settings_missing: 'ההגדרות עדיין לא נפרסו',
};

function errorLabel(err) {
  if (!err) return '';
  if (ERROR_LABELS[err]) return ERROR_LABELS[err];
  if (err.startsWith('notifier_not_authorized')) return 'הוואטסאפ של הנציג השולח עצמו מנותק';
  if (err.startsWith('green_send_failed')) return 'Green API דחה את השליחה';
  return err;
}

export default function WhatsAppAlertsTab() {
  const queryClient = useQueryClient();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['wa-alerts'],
    queryFn: () => base44.functions.invoke('greenApiSettings', { action: 'alerts_get' }),
    retry: false,
  });

  const [draft, setDraft] = useState({
    enabled: true,
    notifier_user_id: '',
    group_chat_id: '',
    cooldown_minutes: 60,
    notify_on_recovery: true,
  });

  useEffect(() => {
    if (data?.settings) {
      setDraft({
        enabled: data.settings.enabled !== false,
        notifier_user_id: data.settings.notifier_user_id || '',
        group_chat_id: data.settings.group_chat_id || '',
        cooldown_minutes: data.settings.cooldown_minutes ?? 60,
        notify_on_recovery: data.settings.notify_on_recovery !== false,
      });
    }
  }, [data?.settings]);

  const saveMutation = useMutation({
    mutationFn: () => base44.functions.invoke('greenApiSettings', {
      action: 'alerts_save',
      enabled: draft.enabled,
      notifier_user_id: draft.notifier_user_id || null,
      group_chat_id: draft.group_chat_id,
      cooldown_minutes: Number(draft.cooldown_minutes),
      notify_on_recovery: draft.notify_on_recovery,
    }),
    onSuccess: (res) => {
      if (res?.group?.ok) {
        toast.success(`נשמר — הקבוצה "${res.group.group_name}" אותרה ✅`);
      } else if (res?.group?.error) {
        toast.warning(`נשמר, אך בדיקת הקבוצה נכשלה: ${errorLabel(res.group.error)}`);
      } else {
        toast.success('הגדרות ההתראות נשמרו');
      }
      queryClient.invalidateQueries({ queryKey: ['wa-alerts'] });
    },
    onError: (err) => toast.error(`שמירה נכשלה: ${errorLabel(err?.message) || 'שגיאה'}`),
  });

  const testMutation = useMutation({
    mutationFn: () => base44.functions.invoke('greenApiSettings', { action: 'alerts_test' }),
    onSuccess: (res) => {
      if (res?.ok) toast.success('הודעת בדיקה נשלחה לקבוצה ✅');
      else toast.error(`שליחת הבדיקה נכשלה: ${errorLabel(res?.error)}`);
      queryClient.invalidateQueries({ queryKey: ['wa-alerts'] });
    },
    onError: (err) => toast.error(`שליחת הבדיקה נכשלה: ${err?.message || 'שגיאה'}`),
  });

  const sweepMutation = useMutation({
    mutationFn: () => base44.functions.invoke('greenApiSettings', { action: 'alerts_sweep' }),
    onSuccess: (res) => {
      const parts = [`נבדקו ${res?.checked ?? 0} חיבורים`];
      if (res?.disconnected) parts.push(`${res.disconnected} מנותקים`);
      if (res?.sent) parts.push(`${res.sent} התראות נשלחו`);
      if (res?.recovered) parts.push(`${res.recovered} חזרו לפעול`);
      if (res?.unreachable) parts.push(`${res.unreachable} לא נגישים`);
      toast.success(parts.join(' · '));
      queryClient.invalidateQueries({ queryKey: ['wa-alerts'] });
    },
    onError: (err) => toast.error(`הבדיקה נכשלה: ${err?.message || 'שגיאה'}`),
  });

  const muteMutation = useMutation({
    mutationFn: ({ userId, muted }) => base44.functions.invoke('greenApiSettings', {
      action: 'alerts_mute', user_id: userId, muted,
    }),
    onSuccess: (_res, vars) => {
      toast.success(vars.muted ? 'ההתראות על הנציג הושתקו' : 'ההתראות על הנציג הופעלו');
      queryClient.invalidateQueries({ queryKey: ['wa-alerts'] });
    },
    onError: (err) => toast.error(`העדכון נכשל: ${err?.message || 'שגיאה'}`),
  });

  const Title = (
    <div>
      <CardTitle className="text-base">התראות ניתוק וואטסאפ</CardTitle>
      <CardDescription>הודעה אוטומטית לקבוצה כשהוואטסאפ של נציג מתנתק</CardDescription>
    </div>
  );

  if (isLoading) {
    return (
      <Card>
        <CardHeader>{Title}</CardHeader>
        <CardContent><div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div></CardContent>
      </Card>
    );
  }

  if (isError || !data?.settings) {
    return (
      <Card>
        <CardHeader>{Title}</CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">
            לא ניתן לטעון את הגדרות ההתראות. ייתכן שטבלת <code>whatsapp_alert_settings</code> או
            הפונקציה <code>greenApiSettings</code> עדיין לא נפרסו. נסה שוב בעוד כמה דקות.
          </p>
          <p className="text-xs text-muted-foreground mt-2">{error?.message}</p>
        </CardContent>
      </Card>
    );
  }

  const reps = data.reps || [];
  const senders = reps.filter((r) => r.configured && r.is_active);
  const notifier = reps.find((r) => r.user_id === draft.notifier_user_id);
  const monitored = reps.filter((r) => r.configured && r.is_active && r.was_authorized);
  const down = monitored.filter((r) => !r.connected);
  const ready = draft.enabled && !!draft.notifier_user_id && !!draft.group_chat_id;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-green-100 text-green-700">
            <Bell className="h-5 w-5" />
          </span>
          {Title}
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* What this does — the mechanism, in one box. */}
        <div className="flex items-start gap-2 rounded-lg bg-muted/40 p-3">
          <Zap className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
          <p className="text-xs text-muted-foreground leading-relaxed">
            ברגע שהוואטסאפ של נציג מתנתק, Green API מודיע למערכת מיידית (webhook) והמערכת שולחת
            הודעה אחת לקבוצה שנבחרה — <b>מהוואטסאפ של הנציג השולח</b>, ולכן המספר שלו חייב להיות
            חבר בקבוצה. בנוסף רצה סריקה מתוזמנת כל 10 דקות כגיבוי, למקרה שההודעה מ-Green לא הגיעה.
          </p>
        </div>

        {/* Live status of who's connected right now */}
        <div className={`rounded-lg border p-3 flex items-start gap-2 ${down.length ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'}`}>
          {down.length
            ? <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
            : <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />}
          <div className="text-sm space-y-0.5">
            <p className={`font-medium ${down.length ? 'text-red-800' : 'text-green-800'}`}>
              {down.length
                ? `${down.length} נציגים מנותקים כרגע: ${down.map((r) => r.name).join(', ')}`
                : `כל ${monitored.length} החיבורים תקינים`}
            </p>
            <p className={`text-xs ${down.length ? 'text-red-700' : 'text-green-700'}`}>
              {ready ? 'ההתראות פעילות' : 'ההתראות אינן פעילות — יש לבחור נציג שולח וקבוצה'}
            </p>
          </div>
        </div>

        {/* ── Config ───────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
          <div>
            <p className="text-sm font-medium">שליחת התראות</p>
            <p className="text-xs text-muted-foreground">כיבוי עוצר את כל ההודעות לקבוצה (הניטור עצמו ממשיך)</p>
          </div>
          <Switch checked={draft.enabled} onCheckedChange={(v) => setDraft((d) => ({ ...d, enabled: v }))} />
        </div>

        <div className="space-y-2">
          <Label>הנציג ששולח את ההתראה</Label>
          <Select
            value={draft.notifier_user_id || ''}
            onValueChange={(v) => setDraft((d) => ({ ...d, notifier_user_id: v }))}
            dir="rtl"
          >
            <SelectTrigger><SelectValue placeholder="בחר נציג" /></SelectTrigger>
            <SelectContent>
              {senders.map((r) => (
                <SelectItem key={r.user_id} value={r.user_id}>
                  {r.name}{r.connected ? '' : ` — ${r.state_label}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">
            ההודעה נשלחת מהמספר של הנציג הזה. ודא שהמספר שלו חבר בקבוצה שנבחרה.
          </p>
          {notifier && !notifier.connected && (
            <p className="text-[11px] text-amber-700 bg-amber-50 rounded p-2">
              הוואטסאפ של הנציג השולח עצמו אינו מחובר כרגע ({notifier.state_label}) — כל עוד זה המצב לא
              תישלח אף התראה. ההתראה לא תאבד: היא תישלח מיד כשהחיבור שלו יחזור.
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="wa-alerts-group">מזהה הקבוצה (Group ID)</Label>
          <Input
            id="wa-alerts-group"
            value={draft.group_chat_id}
            onChange={(e) => setDraft((d) => ({ ...d, group_chat_id: e.target.value }))}
            placeholder="120363410077585252@g.us"
            dir="ltr"
          />
          <p className="text-[11px] text-muted-foreground">
            מזהה הקבוצה בוואטסאפ, בפורמט <code dir="ltr">מספר@g.us</code>. אפשר להזין רק את המספר —
            הסיומת תתווסף אוטומטית. לאחר השמירה המערכת מוודאת מול Green API שהקבוצה קיימת ושהנציג השולח חבר בה.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="wa-alerts-cooldown">מרווח מינימלי בין התראות (דקות)</Label>
            <Input
              id="wa-alerts-cooldown"
              type="number"
              min={0}
              value={draft.cooldown_minutes}
              onChange={(e) => setDraft((d) => ({ ...d, cooldown_minutes: e.target.value }))}
              dir="ltr"
            />
            <p className="text-[11px] text-muted-foreground">
              על כל ניתוק נשלחת הודעה אחת בלבד. הערך הזה מונע הצפה כשחיבור "מקפץ" — מתנתק ומתחבר שוב ושוב.
            </p>
          </div>

          <div className="flex items-start justify-between gap-3 rounded-lg border p-3 h-fit">
            <div>
              <p className="text-sm font-medium">הודעה גם כשחוזר לפעול</p>
              <p className="text-xs text-muted-foreground">"🟢 הוואטסאפ של X מחובר שוב"</p>
            </div>
            <Switch
              checked={draft.notify_on_recovery}
              onCheckedChange={(v) => setDraft((d) => ({ ...d, notify_on_recovery: v }))}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} className="gap-2">
            {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            שמור
          </Button>
          <Button
            variant="outline"
            onClick={() => testMutation.mutate()}
            disabled={testMutation.isPending || !draft.notifier_user_id || !draft.group_chat_id}
            className="gap-2"
          >
            {testMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            שלח הודעת בדיקה
          </Button>
          <Button variant="ghost" onClick={() => sweepMutation.mutate()} disabled={sweepMutation.isPending} className="gap-2">
            {sweepMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            בדוק עכשיו
          </Button>
        </div>

        <Separator />

        {/* ── Who is monitored ─────────────────────────────────────────── */}
        <div className="space-y-2">
          <p className="text-sm font-medium flex items-center gap-1.5">
            <Users className="h-4 w-4" />
            נציגים במעקב
          </p>
          {monitored.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              אין עדיין נציגים שהוואטסאפ שלהם חובר. נציג נכנס למעקב אחרי הסריקה הראשונה של ה-QR.
            </p>
          ) : (
            <div className="rounded-lg border divide-y">
              {monitored.map((r) => (
                <div key={r.user_id} className="flex items-center justify-between gap-3 p-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{r.name}</p>
                    <p className={`text-xs ${r.connected ? 'text-green-700' : 'text-red-700'}`}>
                      {r.connected ? 'מחובר' : r.state_label}
                      {!r.connected && r.disconnected_since ? ` · מאז ${relTime(r.disconnected_since)}` : ''}
                      {!r.connected && r.alerted ? ' · דווח לקבוצה' : ''}
                      {r.alert_error ? ` · שגיאה: ${errorLabel(r.alert_error)}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[11px] text-muted-foreground">
                      {r.alerts_muted ? 'מושתק' : 'מדווח'}
                    </span>
                    <Switch
                      checked={!r.alerts_muted}
                      onCheckedChange={(v) => muteMutation.mutate({ userId: r.user_id, muted: !v })}
                      disabled={muteMutation.isPending}
                      aria-label={r.alerts_muted ? 'הפעל התראות' : 'השתק התראות'}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── What was actually sent ───────────────────────────────────── */}
        {(data.log || []).length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">התראות אחרונות</p>
            <div className="rounded-lg border divide-y max-h-72 overflow-y-auto">
              {data.log.map((l) => (
                <div key={l.id} className="flex items-start justify-between gap-3 p-2.5 text-xs">
                  <div className="min-w-0">
                    <p className="font-medium truncate">
                      {l.ok
                        ? <CheckCircle2 className="inline h-3.5 w-3.5 text-green-600 ms-1" />
                        : <AlertTriangle className="inline h-3.5 w-3.5 text-red-600 ms-1" />}
                      {LOG_KIND_LABELS[l.kind] || l.kind}
                      {l.rep_name ? ` — ${l.rep_name}` : ''}
                    </p>
                    <p className="text-muted-foreground">
                      {new Date(l.created_date).toLocaleString('he-IL')}
                      {l.source ? ` · ${l.source}` : ''}
                      {l.error ? ` · ${errorLabel(l.error)}` : ''}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {senders.length === 0 && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 flex items-start gap-2">
            <BellOff className="h-4 w-4 text-amber-700 mt-0.5 shrink-0" />
            <p className="text-xs text-amber-800">
              אף נציג עדיין לא חיבר Green API, ולכן אין דרך לשלוח את ההתראה. חבר נציג במסך
              "נציגים ← נהל נציג ← וואטסאפ" וחזור לכאן.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
