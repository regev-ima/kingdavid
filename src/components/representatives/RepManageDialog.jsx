import React, { useRef, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { supabase } from '@/api/supabaseClient';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Loader2, KeyRound, Upload, FileText, Trash2, Plus, CalendarDays,
  Clock, ShieldCheck, User as UserIcon, Save,
} from 'lucide-react';
import UserAvatar from '@/components/shared/UserAvatar';
import { GRANTABLE_PERMISSIONS, getUserScope, USER_SCOPES } from '@/lib/rbac';

const ROLE_OPTIONS = [
  { value: 'admin', label: 'מנהל' },
  { value: 'sales_user', label: 'נציג מכירות' },
  { value: 'factory_user', label: 'נציג מפעל' },
  { value: 'bookkeeper', label: 'מנהלת חשבונות' },
];

const WEEKDAYS = [
  { idx: 0, label: 'ראשון' },
  { idx: 1, label: 'שני' },
  { idx: 2, label: 'שלישי' },
  { idx: 3, label: 'רביעי' },
  { idx: 4, label: 'חמישי' },
  { idx: 5, label: 'שישי' },
  { idx: 6, label: 'שבת' },
];

const VACATION_TYPES = [
  { value: 'vacation', label: 'חופשה' },
  { value: 'sick', label: 'מחלה' },
  { value: 'reserve', label: 'מילואים' },
  { value: 'other', label: 'אחר' },
];

const DOC_CATEGORIES = [
  { value: 'contract', label: 'הסכם עבודה' },
  { value: 'id', label: 'תעודת זהות' },
  { value: 'form101', label: 'טופס 101' },
  { value: 'certificate', label: 'תעודה / הסמכה' },
  { value: 'other', label: 'אחר' },
];

const labelFor = (list, value, fallback = '') =>
  list.find((o) => o.value === value)?.label ?? fallback;

// Build a normalised 0..6 schedule from whatever is stored (keys may be
// numbers or strings; missing days fall back to a sensible Sun–Thu default).
function initSchedule(rep) {
  const stored = rep?.work_schedule || {};
  const out = {};
  for (const d of WEEKDAYS) {
    const e = stored[d.idx] ?? stored[String(d.idx)] ?? {};
    out[d.idx] = {
      works: typeof e.works === 'boolean' ? e.works : d.idx >= 0 && d.idx <= 4,
      start: e.start || '09:00',
      end: e.end || '17:00',
    };
  }
  return out;
}

// Whole days between two ISO dates, inclusive. Returns 0 for invalid input.
function daysBetween(start, end) {
  if (!start || !end) return 0;
  const a = new Date(start);
  const b = new Date(end);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || b < a) return 0;
  return Math.round((b - a) / 86_400_000) + 1;
}

const newId = () =>
  (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `id_${Date.now()}_${Math.random().toString(36).slice(2)}`;

export default function RepManageDialog({ rep, onClose, currentUserEmail, onRequestDeactivate }) {
  const queryClient = useQueryClient();

  // ── Details ──
  const [fullName, setFullName] = useState(rep?.full_name || '');
  const [phone, setPhone] = useState(rep?.phone || '');
  const [extension, setExtension] = useState(rep?.voicenter_extension || '');
  const [role, setRole] = useState(rep?.role || 'user');
  const [commission, setCommission] = useState(rep?.commission_rate ?? '');
  const [isActive, setIsActive] = useState(rep?.is_active !== false);

  // ── Schedule / vacation / permissions / documents ──
  const [schedule, setSchedule] = useState(() => initSchedule(rep));
  const [annualDays, setAnnualDays] = useState(rep?.annual_vacation_days ?? '');
  const [vacations, setVacations] = useState(() => rep?.vacation_days || []);
  const [permissions, setPermissions] = useState(() => rep?.extra_permissions || {});
  const [documents, setDocuments] = useState(() => rep?.documents || []);

  const [resetting, setResetting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [docCategory, setDocCategory] = useState('contract');
  const fileInputRef = useRef(null);

  const saveMutation = useMutation({
    mutationFn: ({ data }) => base44.entities.User.update(rep.id, data),
    onSuccess: (_r, vars) => {
      queryClient.invalidateQueries(['reps']);
      toast.success(vars.successMsg || 'הנציג עודכן');
    },
    onError: (err) => {
      toast.error(`עדכון נכשל: ${err?.message || 'שגיאה לא ידועה'}`, { duration: 8000 });
    },
  });
  const saving = saveMutation.isPending;

  const usedVacationDays = vacations
    .filter((v) => v.type === 'vacation' || !v.type)
    .reduce((sum, v) => sum + daysBetween(v.start_date, v.end_date), 0);

  // ── Details save ──
  const handleSaveDetails = () => {
    const data = {
      full_name: fullName.trim(),
      phone: phone.trim(),
      voicenter_extension: extension.trim(),
      role,
      commission_rate: commission === '' ? 0 : parseFloat(commission) || 0,
      is_active: isActive,
    };
    saveMutation.mutate({ data, successMsg: 'פרטי הנציג נשמרו' });
  };

  // ── Password reset ──
  const handleResetPassword = async () => {
    if (!rep?.email) return;
    setResetting(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(rep.email, {
        redirectTo: `${window.location.origin}/login`,
      });
      if (error) throw error;
      toast.success(`נשלח מייל לאיפוס סיסמה ל-${rep.email}`);
    } catch (err) {
      toast.error(`שליחת מייל האיפוס נכשלה: ${err?.message || 'שגיאה לא ידועה'}`);
    } finally {
      setResetting(false);
    }
  };

  // ── Schedule ──
  const updateDay = (idx, patch) =>
    setSchedule((prev) => ({ ...prev, [idx]: { ...prev[idx], ...patch } }));

  const handleSaveSchedule = () =>
    saveMutation.mutate({ data: { work_schedule: schedule }, successMsg: 'הלו״ז השבועי נשמר' });

  // ── Vacation ──
  const addVacation = () =>
    setVacations((prev) => [
      ...prev,
      { id: newId(), start_date: '', end_date: '', type: 'vacation', note: '' },
    ]);
  const updateVacation = (id, patch) =>
    setVacations((prev) => prev.map((v) => (v.id === id ? { ...v, ...patch } : v)));
  const removeVacation = (id) =>
    setVacations((prev) => prev.filter((v) => v.id !== id));

  const handleSaveVacation = () =>
    saveMutation.mutate({
      data: {
        vacation_days: vacations,
        annual_vacation_days: annualDays === '' ? null : parseInt(annualDays, 10) || 0,
      },
      successMsg: 'ימי החופשה נשמרו',
    });

  // ── Permissions ──
  const togglePermission = (key, value) =>
    setPermissions((prev) => ({ ...prev, [key]: value }));

  const handleSavePermissions = () =>
    saveMutation.mutate({ data: { extra_permissions: permissions }, successMsg: 'ההרשאות נשמרו' });

  // ── Documents (auto-persist on upload / delete) ──
  const persistDocuments = async (nextDocs, successMsg) => {
    try {
      await base44.entities.User.update(rep.id, { documents: nextDocs });
      setDocuments(nextDocs);
      queryClient.invalidateQueries(['reps']);
      if (successMsg) toast.success(successMsg);
    } catch (err) {
      toast.error(`שמירת הקובץ נכשלה: ${err?.message || 'שגיאה לא ידועה'}`);
    }
  };

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (e.target) e.target.value = '';
    if (!file) return;
    setUploading(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      const doc = {
        id: newId(),
        name: file.name,
        url: file_url,
        category: docCategory,
        uploaded_at: new Date().toISOString(),
        uploaded_by: currentUserEmail || '',
      };
      await persistDocuments([...documents, doc], 'הקובץ הועלה');
    } catch (err) {
      toast.error(`העלאת הקובץ נכשלה: ${err?.message || 'שגיאה לא ידועה'}`);
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteDoc = (id) =>
    persistDocuments(documents.filter((d) => d.id !== id), 'הקובץ נמחק');

  const scope = getUserScope({ ...rep, role });
  const scopeLabel = {
    [USER_SCOPES.ADMIN]: 'מנהל — גישה מלאה',
    [USER_SCOPES.SALES]: 'נציג מכירות — לידים, הצעות והזמנות שלו',
    [USER_SCOPES.FACTORY]: 'נציג מפעל — אזור המפעל והייצור',
    [USER_SCOPES.BOOKKEEPER]: 'מנהלת חשבונות — אזור חשבוניות ופיננסים',
  }[scope] || '';

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        dir="rtl"
        className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col p-0 [&>button]:left-4 [&>button]:right-auto"
      >
        <DialogHeader className="px-6 pt-5 pb-4 border-b pe-14 space-y-0">
          <div className="flex items-center gap-3">
            <UserAvatar user={rep} size="md" />
            <div className="min-w-0 flex-1 text-right">
              <div className="flex items-center gap-2">
                <DialogTitle className="truncate">{rep?.full_name || rep?.email}</DialogTitle>
                <Badge
                  variant={isActive ? 'default' : 'secondary'}
                  className={`shrink-0 ${isActive ? 'bg-green-100 text-green-800 hover:bg-green-100' : 'bg-muted text-muted-foreground'}`}
                >
                  {isActive ? 'פעיל' : 'לא פעיל'}
                </Badge>
              </div>
              <DialogDescription className="truncate">{rep?.email}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <Tabs defaultValue="details" className="flex-1 min-h-0 flex flex-col">
          <TabsList className="mx-6 mt-3 grid grid-cols-5 shrink-0">
            <TabsTrigger value="details" className="gap-1 text-xs"><UserIcon className="h-3.5 w-3.5" />פרטים</TabsTrigger>
            <TabsTrigger value="schedule" className="gap-1 text-xs"><Clock className="h-3.5 w-3.5" />לו״ז</TabsTrigger>
            <TabsTrigger value="vacation" className="gap-1 text-xs"><CalendarDays className="h-3.5 w-3.5" />חופשות</TabsTrigger>
            <TabsTrigger value="permissions" className="gap-1 text-xs"><ShieldCheck className="h-3.5 w-3.5" />הרשאות</TabsTrigger>
            <TabsTrigger value="documents" className="gap-1 text-xs"><FileText className="h-3.5 w-3.5" />קבצים</TabsTrigger>
          </TabsList>

          <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
            {/* ── Details ── */}
            <TabsContent value="details" className="mt-0 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>שם מלא</Label>
                  <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="שם הנציג" />
                </div>
                <div className="space-y-1.5">
                  <Label>אימייל</Label>
                  <Input value={rep?.email || ''} disabled className="bg-muted/50" />
                  <p className="text-[11px] text-muted-foreground">כתובת ההתחברות — לא ניתנת לעריכה כאן.</p>
                </div>
                <div className="space-y-1.5">
                  <Label>טלפון נייד</Label>
                  <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="050-0000000" />
                </div>
                <div className="space-y-1.5">
                  <Label>מספר שלוחה</Label>
                  <Input value={extension} onChange={(e) => setExtension(e.target.value)} placeholder="שלוחה" />
                </div>
                <div className="space-y-1.5">
                  <Label>תפקיד</Label>
                  <Select value={role} onValueChange={setRole}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ROLE_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>עמלה (%)</Label>
                  <Input
                    type="number" min="0" max="100"
                    value={commission}
                    onChange={(e) => setCommission(e.target.value)}
                    placeholder="0"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <p className="text-sm font-medium">סטטוס נציג</p>
                  <p className="text-xs text-muted-foreground">
                    נציג לא פעיל לא יוכל להתחבר ולא יקבל לידים חדשים.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm">{isActive ? 'פעיל' : 'לא פעיל'}</span>
                  <Switch
                    checked={isActive}
                    onCheckedChange={setIsActive}
                    disabled={rep?.email === currentUserEmail}
                  />
                </div>
              </div>
              {rep?.email === currentUserEmail && (
                <p className="text-[11px] text-amber-600">לא ניתן להשבית את המשתמש שאיתו אתה מחובר.</p>
              )}
              {onRequestDeactivate && isActive && rep?.email !== currentUserEmail && (
                <button
                  type="button"
                  onClick={() => { onClose(); onRequestDeactivate(rep); }}
                  className="text-xs text-red-600 hover:underline"
                >
                  השבת והעבר את כל הלידים לנציג אחר ←
                </button>
              )}

              <div className="flex justify-end">
                <Button onClick={handleSaveDetails} disabled={saving} className="gap-2">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  שמור פרטים
                </Button>
              </div>

              <Separator />

              <div className="rounded-lg border p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <KeyRound className="h-4 w-4 text-amber-600" />
                  <p className="text-sm font-medium">סיסמה</p>
                </div>
                <p className="text-xs text-muted-foreground">
                  שליחת מייל לנציג עם קישור לקביעת סיסמה חדשה. הנציג בוחר סיסמה בעצמו.
                </p>
                <Button variant="outline" size="sm" onClick={handleResetPassword} disabled={resetting} className="gap-2">
                  {resetting ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                  שלח מייל לאיפוס סיסמה
                </Button>
              </div>
            </TabsContent>

            {/* ── Weekly schedule ── */}
            <TabsContent value="schedule" className="mt-0 space-y-3">
              <p className="text-sm text-muted-foreground">
                סמן באילו ימים הנציג עובד ובאילו שעות.
              </p>
              <div className="space-y-2">
                {WEEKDAYS.map((d) => {
                  const day = schedule[d.idx];
                  return (
                    <div key={d.idx} className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
                      <div className="flex items-center gap-2 w-28">
                        <Switch checked={day.works} onCheckedChange={(v) => updateDay(d.idx, { works: v })} />
                        <span className="text-sm font-medium">{d.label}</span>
                      </div>
                      {day.works ? (
                        <div className="flex items-center gap-2 text-sm">
                          <span className="text-muted-foreground">מ־</span>
                          <Input
                            type="time" value={day.start}
                            onChange={(e) => updateDay(d.idx, { start: e.target.value })}
                            className="h-8 w-28"
                          />
                          <span className="text-muted-foreground">עד</span>
                          <Input
                            type="time" value={day.end}
                            onChange={(e) => updateDay(d.idx, { end: e.target.value })}
                            className="h-8 w-28"
                          />
                        </div>
                      ) : (
                        <span className="text-sm text-muted-foreground">יום חופשי</span>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-end">
                <Button onClick={handleSaveSchedule} disabled={saving} className="gap-2">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  שמור לו״ז
                </Button>
              </div>
            </TabsContent>

            {/* ── Vacation ── */}
            <TabsContent value="vacation" className="mt-0 space-y-4">
              <div className="flex flex-wrap items-end gap-4">
                <div className="space-y-1.5">
                  <Label>מכסת ימי חופשה שנתית</Label>
                  <Input
                    type="number" min="0"
                    value={annualDays}
                    onChange={(e) => setAnnualDays(e.target.value)}
                    placeholder="לדוגמה 12"
                    className="w-40"
                  />
                </div>
                <div className="rounded-lg bg-muted/50 px-4 py-2 text-sm">
                  <span className="text-muted-foreground">נוצלו: </span>
                  <span className="font-semibold">{usedVacationDays}</span>
                  {annualDays !== '' && (
                    <>
                      <span className="text-muted-foreground"> / {annualDays} · נותרו: </span>
                      <span className="font-semibold">{Math.max(0, (parseInt(annualDays, 10) || 0) - usedVacationDays)}</span>
                    </>
                  )}
                  <span className="text-muted-foreground"> ימי חופשה</span>
                </div>
              </div>

              <Separator />

              <div className="space-y-2">
                {vacations.length === 0 && (
                  <p className="text-sm text-muted-foreground py-4 text-center">לא הוזנו ימי חופשה.</p>
                )}
                {vacations.map((v) => (
                  <div key={v.id} className="flex flex-wrap items-end gap-2 rounded-lg border p-3">
                    <div className="space-y-1">
                      <Label className="text-xs">מתאריך</Label>
                      <Input
                        type="date" value={v.start_date || ''}
                        onChange={(e) => updateVacation(v.id, { start_date: e.target.value })}
                        className="h-8 w-40"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">עד תאריך</Label>
                      <Input
                        type="date" value={v.end_date || ''}
                        onChange={(e) => updateVacation(v.id, { end_date: e.target.value })}
                        className="h-8 w-40"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">סוג</Label>
                      <Select value={v.type || 'vacation'} onValueChange={(val) => updateVacation(v.id, { type: val })}>
                        <SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {VACATION_TYPES.map((t) => (
                            <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1 flex-1 min-w-[120px]">
                      <Label className="text-xs">הערה</Label>
                      <Input
                        value={v.note || ''}
                        onChange={(e) => updateVacation(v.id, { note: e.target.value })}
                        className="h-8"
                        placeholder="הערה (לא חובה)"
                      />
                    </div>
                    <div className="text-xs text-muted-foreground pb-2 w-16 text-center">
                      {daysBetween(v.start_date, v.end_date)} ימים
                    </div>
                    <Button
                      variant="ghost" size="icon"
                      onClick={() => removeVacation(v.id)}
                      className="h-8 w-8 text-red-600 hover:bg-red-50"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between">
                <Button variant="outline" size="sm" onClick={addVacation} className="gap-1">
                  <Plus className="h-4 w-4" />הוסף חופשה
                </Button>
                <Button onClick={handleSaveVacation} disabled={saving} className="gap-2">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  שמור חופשות
                </Button>
              </div>
            </TabsContent>

            {/* ── Permissions ── */}
            <TabsContent value="permissions" className="mt-0 space-y-4">
              <div className="rounded-lg bg-muted/40 p-3 text-sm">
                <p className="font-medium">הרשאות לפי תפקיד</p>
                <p className="text-muted-foreground text-xs mt-0.5">{scopeLabel}</p>
                <p className="text-muted-foreground text-xs mt-1">
                  ההרשאות שלמטה מתווספות מעל מה שהתפקיד כבר מאפשר.
                </p>
              </div>
              <div className="space-y-2">
                {GRANTABLE_PERMISSIONS.map((p) => {
                  const checked = role === 'admin' ? true : permissions[p.key] === true;
                  return (
                    <div key={p.key} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{p.label}</p>
                        <p className="text-xs text-muted-foreground">{p.description}</p>
                      </div>
                      <Switch
                        checked={checked}
                        disabled={role === 'admin'}
                        onCheckedChange={(v) => togglePermission(p.key, v)}
                      />
                    </div>
                  );
                })}
              </div>
              {role === 'admin' && (
                <p className="text-[11px] text-muted-foreground">מנהל מקבל את כל ההרשאות באופן אוטומטי.</p>
              )}
              <div className="flex justify-end">
                <Button onClick={handleSavePermissions} disabled={saving || role === 'admin'} className="gap-2">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  שמור הרשאות
                </Button>
              </div>
            </TabsContent>

            {/* ── Documents ── */}
            <TabsContent value="documents" className="mt-0 space-y-4">
              <div className="flex flex-wrap items-end gap-3 rounded-lg border p-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">סוג מסמך</Label>
                  <Select value={docCategory} onValueChange={setDocCategory}>
                    <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {DOC_CATEGORIES.map((c) => (
                        <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  accept=".pdf,.png,.jpg,.jpeg,.webp,.csv,.xlsx"
                  onChange={handleUpload}
                />
                <Button
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="gap-2"
                >
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  העלה קובץ
                </Button>
                <p className="text-[11px] text-muted-foreground flex-1">
                  PDF / תמונה / אקסל. עד 50MB.
                </p>
              </div>

              <div className="space-y-2">
                {documents.length === 0 && (
                  <p className="text-sm text-muted-foreground py-6 text-center">טרם הועלו מסמכים.</p>
                )}
                {documents.map((doc) => (
                  <div key={doc.id} className="flex items-center gap-3 rounded-lg border p-3">
                    <FileText className="h-5 w-5 text-primary shrink-0" />
                    <div className="min-w-0 flex-1">
                      <a
                        href={doc.url} target="_blank" rel="noreferrer"
                        className="text-sm font-medium text-primary hover:underline truncate block"
                      >
                        {doc.name}
                      </a>
                      <p className="text-xs text-muted-foreground">
                        {labelFor(DOC_CATEGORIES, doc.category, 'אחר')}
                        {doc.uploaded_at && ` · ${new Date(doc.uploaded_at).toLocaleDateString('he-IL')}`}
                      </p>
                    </div>
                    <Button
                      variant="ghost" size="icon"
                      onClick={() => handleDeleteDoc(doc.id)}
                      className="h-8 w-8 text-red-600 hover:bg-red-50"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
