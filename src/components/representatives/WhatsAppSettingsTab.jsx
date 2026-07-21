import React, { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader,
  AlertDialogFooter, AlertDialogTitle, AlertDialogDescription,
  AlertDialogAction, AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import {
  Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import {
  Loader2, Save, Eye, EyeOff, Plug, Unplug, RefreshCw, CheckCircle2,
  AlertTriangle, MessageCircle, KeyRound, Copy, Activity, Trash2, QrCode,
} from 'lucide-react';

// Per-rep Green API (WhatsApp) connection. The api_token is a secret stored
// server-side (whatsapp_accounts, RLS-locked) — the browser only ever sees a
// masked hint. Everything goes through the greenApiSettings Edge Function with
// the rep's user_id, so an admin can set this up from "נהל נציג".
//
// This connection mirrors the rep's WhatsApp (incoming + outgoing) AND lets
// them send from the CRM composer (phase 2, via greenApiSend) — both use the
// same Green API instance/token configured here.
export default function WhatsAppSettingsTab({ rep }) {
  const queryClient = useQueryClient();
  const userId = rep?.id;

  const { data: status, isLoading, isError, error } = useQuery({
    queryKey: ['green-api', userId],
    queryFn: () => base44.functions.invoke('greenApiSettings', { action: 'get', user_id: userId }),
    enabled: !!userId,
    retry: false,
  });

  const [draft, setDraft] = useState({ instance_id: '', api_token: '', api_url: '' });
  const [showToken, setShowToken] = useState(false);
  const [diag, setDiag] = useState(null);
  const [qrOpen, setQrOpen] = useState(false);

  useEffect(() => {
    if (status) {
      setDraft({
        instance_id: status.instance_id || '',
        api_token: '',
        api_url: status.api_url || 'https://api.green-api.com',
      });
    }
  }, [status]);

  const saveMutation = useMutation({
    mutationFn: () => base44.functions.invoke('greenApiSettings', {
      action: 'save',
      user_id: userId,
      instance_id: draft.instance_id,
      api_token: draft.api_token, // blank = keep existing
      api_url: draft.api_url,
    }),
    onSuccess: () => {
      toast.success('פרטי Green API נשמרו');
      setDraft((d) => ({ ...d, api_token: '' }));
      setShowToken(false);
      queryClient.invalidateQueries({ queryKey: ['green-api', userId] });
    },
    onError: (err) => toast.error(`שמירה נכשלה: ${err?.message || 'שגיאה'}`),
  });

  const connectMutation = useMutation({
    mutationFn: () => base44.functions.invoke('greenApiSettings', { action: 'connect', user_id: userId }),
    onSuccess: (res) => {
      if (res?.settings_ok) toast.success('הוובהוק חובר ל-Green API ✅');
      else toast.warning('נשמר, אך חיבור הוובהוק ל-Green API לא אושר — בדוק את הקודים');
      queryClient.invalidateQueries({ queryKey: ['green-api', userId] });
    },
    onError: (err) => toast.error(`החיבור נכשל: ${err?.message || 'שגיאה'}`),
  });

  const checkMutation = useMutation({
    mutationFn: () => base44.functions.invoke('greenApiSettings', { action: 'check', user_id: userId }),
    onSuccess: (res) => {
      toast.success(`סטטוס: ${stateLabel(res?.state)}`);
      queryClient.invalidateQueries({ queryKey: ['green-api', userId] });
    },
    onError: (err) => toast.error(`בדיקה נכשלה: ${err?.message || 'שגיאה'}`),
  });

  const diagnoseMutation = useMutation({
    mutationFn: () => base44.functions.invoke('greenApiSettings', { action: 'diagnose', user_id: userId }),
    onSuccess: (res) => {
      setDiag(res);
      queryClient.invalidateQueries({ queryKey: ['green-api', userId] });
    },
    onError: (err) => toast.error(`האבחון נכשל: ${err?.message || 'שגיאה'}`),
  });

  const disconnectMutation = useMutation({
    mutationFn: () => base44.functions.invoke('greenApiSettings', { action: 'disconnect', user_id: userId }),
    onSuccess: () => {
      toast.success('הוואטסאפ נותק — ההיסטוריה נשמרה');
      setDiag(null);
      setDraft({ instance_id: '', api_token: '', api_url: 'https://api.green-api.com' });
      queryClient.invalidateQueries({ queryKey: ['green-api', userId] });
      // The chats stay, but the composer/monitoring state changes — refresh them.
      queryClient.invalidateQueries({ queryKey: ['wa-chats'] });
      queryClient.invalidateQueries({ queryKey: ['wa-waiting-count'] });
    },
    onError: (err) => toast.error(`הניתוק נכשל: ${err?.message || 'שגיאה'}`),
  });

  const purgeMutation = useMutation({
    mutationFn: () => base44.functions.invoke('greenApiSettings', { action: 'purge', user_id: userId }),
    onSuccess: () => {
      toast.success('היסטוריית ההודעות נמחקה');
      setDiag(null);
      queryClient.invalidateQueries({ queryKey: ['green-api', userId] });
      queryClient.invalidateQueries({ queryKey: ['wa-chats'] });
      queryClient.invalidateQueries({ queryKey: ['wa-waiting-count'] });
      queryClient.invalidateQueries({ queryKey: ['wa-rep-stats'] });
    },
    onError: (err) => toast.error(`המחיקה נכשלה: ${err?.message || 'שגיאה'}`),
  });

  if (isLoading) {
    return <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  if (isError) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
        <p className="text-destructive font-medium">לא ניתן לטעון את הגדרות ה-WhatsApp מהשרת.</p>
        <p className="text-xs text-muted-foreground mt-1">
          ייתכן שהפונקציה <code>greenApiSettings</code> או הטבלאות עדיין לא נפרסו. נסה שוב בעוד כמה דקות.
        </p>
        <p className="text-[11px] text-muted-foreground mt-2">{error?.message}</p>
      </div>
    );
  }

  const configured = status?.configured;
  const authorized = status?.state === 'authorized';

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-lg bg-muted/40 p-3">
        <MessageCircle className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
        <p className="text-xs text-muted-foreground">
          חיבור הוואטסאפ של הנציג למערכת דרך Green API. לאחר החיבור ניתן <b>לשלוח ולקבל</b> הודעות
          — כל ההודעות (נכנסות ויוצאות, כולל שנשלחו מהמערכת) יופיעו במסך "צ'אט וואטסאפ".
        </p>
      </div>

      {/* Connection status */}
      {configured ? (
        <div className={`p-3 rounded-lg border flex items-start gap-2 ${authorized ? 'bg-green-50 border-green-200' : 'bg-yellow-50 border-yellow-200'}`}>
          {authorized
            ? <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
            : <AlertTriangle className="h-4 w-4 text-yellow-600 mt-0.5 shrink-0" />}
          <div className="text-sm space-y-0.5">
            <p className={`font-medium ${authorized ? 'text-green-800' : 'text-yellow-800'}`}>
              {authorized ? 'מחובר ומאומת' : `סטטוס: ${stateLabel(status.state)}`}
            </p>
            <p className={`text-xs ${authorized ? 'text-green-700' : 'text-yellow-700'}`}>
              {status.phone ? `מספר: ${status.phone} · ` : ''}
              {status.webhook_set ? 'וובהוק מוגדר' : 'וובהוק לא מוגדר עדיין'}
              {status.last_webhook_at ? ` · התקבל לאחרונה: ${new Date(status.last_webhook_at).toLocaleString('he-IL')}` : ''}
            </p>
          </div>
        </div>
      ) : (
        <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-yellow-600 mt-0.5 shrink-0" />
          <div className="text-sm text-yellow-800">
            <p className="font-medium">החיבור עדיין לא הוגדר</p>
            <p className="text-xs text-yellow-700">הזן את ה-ID Instance וה-API Token מחשבון Green API של הנציג ולחץ "שמור".</p>
          </div>
        </div>
      )}

      {/* Credentials */}
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label>ID Instance</Label>
          <Input
            value={draft.instance_id}
            onChange={(e) => setDraft({ ...draft, instance_id: e.target.value })}
            placeholder="1101000001"
            dir="ltr"
          />
        </div>

        <div className="space-y-1.5">
          <Label>API Token</Label>
          <div className="relative">
            <Input
              type={showToken ? 'text' : 'password'}
              value={draft.api_token}
              onChange={(e) => setDraft({ ...draft, api_token: e.target.value })}
              placeholder={status?.token_set ? `שמור (${status.token_hint}) — השאר ריק כדי לא לשנות` : 'הדבק כאן את ה-API Token מ-Green API'}
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
            מתוך הקונסולה של Green API ← פרטי המכונה (ID Instance + ApiTokenInstance). הטוקן נשמר מוצפן בשרת.
          </p>
        </div>

        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">הגדרות מתקדמות (כתובת API)</summary>
          <div className="mt-2 space-y-1.5">
            <Label className="text-xs">API URL</Label>
            <Input
              value={draft.api_url}
              onChange={(e) => setDraft({ ...draft, api_url: e.target.value })}
              placeholder="https://api.green-api.com"
              dir="ltr"
              className="h-8"
            />
            <p className="text-[11px] text-muted-foreground">השאר כברירת מחדל אלא אם Green API נתנו כתובת ייעודית למכונה.</p>
          </div>
        </details>

        <div className="flex flex-wrap gap-2 pt-1">
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !draft.instance_id.trim()} className="gap-2">
            {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            שמור
          </Button>
          {configured && !authorized && (
            <Button onClick={() => setQrOpen(true)} className="gap-2 bg-green-600 hover:bg-green-700 text-white">
              <QrCode className="h-4 w-4" />
              חבר מכשיר (QR)
            </Button>
          )}
          <Button variant="outline" onClick={() => connectMutation.mutate()} disabled={connectMutation.isPending || !configured} className="gap-2">
            {connectMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />}
            חבר וובהוק
          </Button>
          <Button variant="ghost" onClick={() => checkMutation.mutate()} disabled={checkMutation.isPending || !configured} className="gap-2">
            {checkMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            בדוק חיבור
          </Button>
          <Button variant="ghost" onClick={() => diagnoseMutation.mutate()} disabled={diagnoseMutation.isPending || !configured} className="gap-2">
            {diagnoseMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Activity className="h-4 w-4" />}
            אבחון
          </Button>
        </div>
      </div>

      {/* Diagnosis results — what Green API ACTUALLY has configured */}
      {diag && (
        <div className="rounded-lg border p-3 space-y-2 text-xs">
          <p className="text-sm font-medium flex items-center gap-1.5"><Activity className="h-4 w-4" />אבחון חיבור</p>
          <DiagRow ok={diag.state === 'authorized'} label="סטטוס מכשיר" value={stateLabel(diag.state)} />
          <DiagRow
            ok={diag.webhook_matches}
            label="כתובת וובהוק ב-Green"
            value={diag.webhook_matches ? 'מוגדרת נכון ✓' : (diag.green?.webhookUrl ? 'שונה מהצפוי' : 'לא מוגדרת')}
          />
          <DiagRow ok={diag.green?.incomingWebhook === 'yes'} label="התראות נכנסות" value={diag.green?.incomingWebhook || '—'} />
          <DiagRow ok={diag.green?.outgoingWebhook === 'yes'} label="התראות יוצאות (טלפון)" value={diag.green?.outgoingWebhook || '—'} />
          <DiagRow ok={diag.green?.outgoingAPIMessageWebhook === 'yes'} label="התראות יוצאות (API)" value={diag.green?.outgoingAPIMessageWebhook || '—'} />
          <DiagRow ok={!!diag.last_webhook_at} label="וובהוק התקבל אצלנו" value={diag.last_webhook_at ? new Date(diag.last_webhook_at).toLocaleString('he-IL') : 'עדיין לא'} />
          <DiagRow ok={diag.messages_count > 0} label="הודעות שנקלטו" value={`${diag.messages_count ?? 0} (${diag.chats_count ?? 0} שיחות)`} />
          {diag.last_message && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">הודעה אחרונה</span>
              <span className="font-medium truncate max-w-[60%]" dir="auto">
                {diag.last_message.direction === 'outgoing' ? '↗ ' : '↘ '}
                {diag.last_message.body || `[${diag.last_message.message_type}]`}
              </span>
            </div>
          )}
          {diag.last_webhook_at && diag.messages_count === 0 && (
            <p className="text-[11px] text-amber-700 bg-amber-50 rounded p-2">
              וובהוק מגיע אלינו אך לא נקלטו הודעות — ייתכן שהתקבל רק עדכון סטטוס. שלח הודעת וואטסאפ אמיתית ונסה שוב.
            </p>
          )}
          {!diag.webhook_matches && (
            <p className="text-[11px] text-amber-700 bg-amber-50 rounded p-2">
              הכתובת אצל Green לא תואמת. לחץ "חבר וובהוק" כדי להגדיר אותה מחדש.
            </p>
          )}
          {diag.webhook_matches && !diag.last_webhook_at && (
            <p className="text-[11px] text-amber-700 bg-amber-50 rounded p-2">
              הכתובת מוגדרת אך עדיין לא התקבלה הודעה. שינוי הגדרות ב-Green עשוי לקחת עד דקה; שלח הודעת בדיקה ונסה שוב.
            </p>
          )}
        </div>
      )}

      {/* Webhook URL reference */}
      {status?.webhook_url && (
        <div className="rounded-lg border p-3 space-y-1.5">
          <p className="text-xs font-medium">כתובת הוובהוק (מוגדרת אוטומטית ב"חבר וובהוק")</p>
          <div className="flex items-center gap-2">
            <code className="text-[11px] bg-muted px-2 py-1 rounded flex-1 truncate" dir="ltr">{status.webhook_url}</code>
            <Button
              variant="ghost" size="icon" className="h-7 w-7"
              onClick={() => { navigator.clipboard?.writeText(status.webhook_url); toast.success('הועתק'); }}
              aria-label="העתק"
            >
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            לחיצה על "חבר וובהוק" מגדירה את הכתובת הזו ב-Green API ומפעילה התראות על הודעות נכנסות ויוצאות.
          </p>
        </div>
      )}

      {/* Disconnect — detach the Green API instance but KEEP the history (admin).
          Amber, not red: no data is deleted. Only shown when there's something
          connected to disconnect. */}
      {configured && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-2">
          <div className="flex items-center gap-2 text-amber-800">
            <Unplug className="h-4 w-4" />
            <p className="text-sm font-medium">ניתוק הוואטסאפ</p>
          </div>
          <p className="text-xs text-amber-800/80">
            ניתוק החשבון מ-Green API. <b>ההיסטוריה (כל השיחות וההודעות) נשמרת</b> וניתן לצפות בה במסך
            "צ'אט וואטסאפ" — רק החיבור מנותק: המערכת תפסיק לקבל ולשלוח הודעות דרך המספר הזה. ניתן לחבר
            מחדש בכל עת ע"י הזנת הקודים ולחיצה על "שמור".
          </p>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="gap-2 border-amber-400 text-amber-800 hover:bg-amber-100"
                disabled={disconnectMutation.isPending}
              >
                {disconnectMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unplug className="h-4 w-4" />}
                נתק את הוואטסאפ (ללא מחיקת היסטוריה)
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent dir="rtl">
              <AlertDialogHeader>
                <AlertDialogTitle>לנתק את הוואטסאפ של הנציג?</AlertDialogTitle>
                <AlertDialogDescription>
                  החיבור ל-Green API ינותק והמערכת תפסיק לקבל/לשלוח הודעות דרך מספר זה.
                  ההיסטוריה שתועדה <b>לא תימחק</b> ותישאר זמינה לצפייה. אפשר לחבר מחדש מאוחר יותר.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>ביטול</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => disconnectMutation.mutate()}
                  className="bg-amber-600 text-white hover:bg-amber-700"
                >
                  כן, נתק
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}

      {/* Danger zone — wipe recorded history (admin) */}
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 space-y-2">
        <div className="flex items-center gap-2 text-destructive">
          <Trash2 className="h-4 w-4" />
          <p className="text-sm font-medium">מחיקת היסטוריה</p>
        </div>
        <p className="text-xs text-muted-foreground">
          מחיקה לצמיתות של כל השיחות וההודעות שתועדו עבור חשבון זה. הקודים והחיבור יישארו —
          רק ההיסטוריה תימחק, ותיעוד הודעות חדשות יימשך. שימושי כשמחברים מספר אישי ולא רוצים
          לשמור הודעות פרטיות.
        </p>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" size="sm" className="gap-2" disabled={purgeMutation.isPending}>
              {purgeMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              מחק את כל היסטוריית ההודעות
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent dir="rtl">
            <AlertDialogHeader>
              <AlertDialogTitle>למחוק את כל ההיסטוריה?</AlertDialogTitle>
              <AlertDialogDescription>
                כל השיחות וההודעות שתועדו עבור חשבון זה יימחקו לצמיתות ולא ניתן יהיה לשחזר אותן.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>ביטול</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => purgeMutation.mutate()}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                כן, מחק הכל
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <QrLinkDialog
        userId={userId}
        open={qrOpen}
        onOpenChange={setQrOpen}
        onLinked={() => queryClient.invalidateQueries({ queryKey: ['green-api', userId] })}
      />
    </div>
  );
}

// Shows the Green API authorization QR inside the CRM so a rep can link their
// phone (WhatsApp → Linked Devices → Link a device) without ever opening the
// Green API console. While open we poll the `qr` action; Green rotates the code
// ~every 20s so we refresh on an interval, and stop the moment the instance
// reports `authorized`.
function QrLinkDialog({ userId, open, onOpenChange, onLinked }) {
  const { data, isFetching, refetch } = useQuery({
    queryKey: ['green-api-qr', userId],
    queryFn: () => base44.functions.invoke('greenApiSettings', { action: 'qr', user_id: userId }),
    enabled: open,
    refetchInterval: (query) => (query.state.data?.authorized ? false : 5000),
    refetchOnWindowFocus: false,
    retry: false,
    gcTime: 0,
  });

  const authorized = data?.authorized;

  useEffect(() => {
    if (open && authorized) {
      toast.success('הוואטסאפ חובר בהצלחה ✅');
      onLinked?.();
      const t = setTimeout(() => onOpenChange(false), 1400);
      return () => clearTimeout(t);
    }
  }, [open, authorized]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-sm">
        <DialogHeader>
          <DialogTitle>חיבור מכשיר וואטסאפ</DialogTitle>
          <DialogDescription>
            סרוק את הקוד מהטלפון של הנציג: וואטסאפ ← הגדרות ← מכשירים מקושרים ← קישור מכשיר.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center justify-center py-2 min-h-[260px]">
          {authorized ? (
            <div className="flex flex-col items-center gap-2 text-green-700">
              <CheckCircle2 className="h-14 w-14" />
              <p className="font-medium">מחובר! הטלפון קושר בהצלחה.</p>
            </div>
          ) : data?.type === 'qrCode' && data?.message ? (
            <>
              <img
                src={`data:image/png;base64,${data.message}`}
                alt="QR code"
                className="h-56 w-56 rounded-lg border bg-white p-2"
              />
              <p className="mt-3 text-xs text-muted-foreground flex items-center gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ממתין לסריקה… הקוד מתרענן אוטומטית
              </p>
            </>
          ) : data?.type === 'error' ? (
            <div className="flex flex-col items-center gap-2 text-amber-700 text-center px-3">
              <AlertTriangle className="h-8 w-8" />
              <p className="text-sm">לא ניתן להביא קוד QR כרגע.</p>
              <p className="text-[11px] text-muted-foreground">
                ייתכן שהמכונה עדיין מתחילה (starting). המתן רגע ולחץ "רענן קוד".
              </p>
              {data.message && <p className="text-[11px] text-muted-foreground" dir="ltr">{String(data.message)}</p>}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin" />
              <p className="text-sm">טוען קוד QR…</p>
            </div>
          )}
        </div>

        <DialogFooter className="sm:justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching} className="gap-2">
            <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
            רענן קוד
          </Button>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>סגור</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DiagRow({ ok, label, value }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        {ok ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600" /> : <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />}
        {label}
      </span>
      <span className={`font-medium ${ok ? 'text-green-700' : 'text-amber-700'}`} dir="ltr">{value}</span>
    </div>
  );
}

function stateLabel(state) {
  return {
    authorized: 'מחובר',
    notAuthorized: 'לא מאומת — לחץ "חבר מכשיר (QR)" וסרוק',
    blocked: 'חסום',
    sleepMode: 'במצב שינה',
    starting: 'מתחיל',
    yellowCard: 'מוגבל זמנית',
  }[state] || state || 'לא ידוע';
}
