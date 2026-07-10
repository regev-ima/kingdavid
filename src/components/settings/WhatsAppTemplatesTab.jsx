import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { buildImproveMessagePrompt } from '@/components/whatsapp/whatsappHelpers';
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader,
  AlertDialogFooter, AlertDialogTitle, AlertDialogDescription,
  AlertDialogAction, AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import {
  Loader2, Plus, Pencil, Trash2, MessageSquareText, Sparkles, Zap,
} from 'lucide-react';

const CATEGORIES = [
  { value: 'general', label: 'כללי' },
  { value: 'sales', label: 'מכירות' },
  { value: 'availability', label: 'זמינות' },
  { value: 'service', label: 'שירות' },
];
const CATEGORY_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.value, c.label]));

const PLACEHOLDERS = ['{{שם}}', '{{שם_מלא}}', '{{נציג}}', '{{טלפון_נציג}}'];

const EMPTY_FORM = { category: 'general', title: '', body: '', shortcut: '', sort_order: 0, is_active: true };

function validateShortcut(value) {
  if (!value) return null;
  if (/[\s/]/.test(value)) return 'קיצור לא יכול להכיל רווחים או "/"';
  return null;
}

// Admin-only CRUD for the WhatsApp message-template library (categories,
// keyboard-shortcut expansion, {{placeholder}} bodies). Reps only ever read
// this table (RLS-enforced) — they consume it via useWhatsAppTemplates() in
// the composer.
export default function WhatsAppTemplatesTab() {
  const queryClient = useQueryClient();
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [shortcutError, setShortcutError] = useState(null);
  const [aiPending, setAiPending] = useState(false);

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['wa-templates-admin'],
    queryFn: () => base44.entities.WhatsAppTemplate.list('sort_order'),
  });

  const filtered = useMemo(
    () => (categoryFilter === 'all' ? templates : templates.filter((t) => t.category === categoryFilter)),
    [templates, categoryFilter],
  );

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['wa-templates-admin'] });

  const saveMutation = useMutation({
    mutationFn: (data) => {
      const payload = {
        category: data.category,
        title: data.title.trim(),
        body: data.body.trim(),
        shortcut: data.shortcut.trim() || null,
        sort_order: Number(data.sort_order) || 0,
        is_active: !!data.is_active,
      };
      return editingId
        ? base44.entities.WhatsAppTemplate.update(editingId, payload)
        : base44.entities.WhatsAppTemplate.create(payload);
    },
    onSuccess: () => {
      toast.success(editingId ? 'התבנית עודכנה' : 'התבנית נוצרה');
      invalidate();
      closeDialog();
    },
    onError: (err) => {
      const msg = /duplicate key|unique/i.test(err?.message || '')
        ? 'קיצור זה כבר קיים בתבנית אחרת'
        : (err?.message || 'שגיאה לא צפויה');
      toast.error(`השמירה נכשלה: ${msg}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.WhatsAppTemplate.delete(id),
    onSuccess: () => { toast.success('התבנית נמחקה'); invalidate(); },
    onError: (err) => toast.error(`המחיקה נכשלה: ${err?.message || 'שגיאה'}`),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, is_active }) => base44.entities.WhatsAppTemplate.update(id, { is_active }),
    onSuccess: invalidate,
    onError: (err) => toast.error(`העדכון נכשל: ${err?.message || 'שגיאה'}`),
  });

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...EMPTY_FORM, category: categoryFilter === 'all' ? 'general' : categoryFilter });
    setShortcutError(null);
    setDialogOpen(true);
  };

  const openEdit = (t) => {
    setEditingId(t.id);
    setForm({
      category: t.category, title: t.title, body: t.body,
      shortcut: t.shortcut || '', sort_order: t.sort_order ?? 0, is_active: t.is_active !== false,
    });
    setShortcutError(null);
    setDialogOpen(true);
  };

  const closeDialog = () => { setDialogOpen(false); setEditingId(null); setForm(EMPTY_FORM); setShortcutError(null); };

  const insertPlaceholder = (ph) => setForm((f) => ({ ...f, body: `${f.body}${f.body && !f.body.endsWith(' ') && !f.body.endsWith('\n') ? ' ' : ''}${ph}` }));

  const handleSubmit = (e) => {
    e.preventDefault();
    const err = validateShortcut(form.shortcut.trim());
    if (err) { setShortcutError(err); return; }
    if (!form.title.trim() || !form.body.trim()) { toast.error('כותרת וגוף ההודעה הם שדות חובה'); return; }
    saveMutation.mutate(form);
  };

  // Prefer IMPROVING the draft the admin already wrote (clarity/tone), so the
  // AI enhances their intent rather than inventing a message. Only when the
  // body is still empty does it fall back to drafting from the title.
  const hasDraft = !!form.body.trim();
  const improveWithAI = async () => {
    const draft = form.body.trim();
    const categoryLabel = CATEGORY_LABEL[form.category] || 'כללי';
    if (!draft && !form.title.trim()) {
      toast.error('כתוב טקסט התחלתי בגוף ההודעה (או כותרת) כדי שה-AI ישפר');
      return;
    }
    setAiPending(true);
    try {
      const prompt = draft
        ? buildImproveMessagePrompt(draft, categoryLabel)
        : `כתוב הודעת וואטסאפ קצרה וידידותית בעברית, בסגנון עסקי-חם, עבור חברת "קינג דוד" (מזרנים ומוצרי שינה). `
          + `קטגוריה: ${categoryLabel}. נושא ההודעה: "${form.title.trim()}". `
          + `אפשר להשתמש בפלייסהולדרים {{שם}} (שם הלקוח) ו-{{נציג}} (שם הנציג) איפה שמתאים. `
          + `החזר רק את טקסט ההודעה עצמה, בלי מרכאות ובלי הסברים.`;
      const res = await base44.integrations.Core.InvokeLLM({ prompt });
      const text = (res?.result || '').trim();
      if (text) setForm((f) => ({ ...f, body: text }));
      else toast.error('לא התקבל טקסט מה-AI');
    } catch (err) {
      toast.error(`${draft ? 'שיפור ההודעה' : 'ניסוח אוטומטי'} נכשל: ${err?.message || 'שגיאה'}`);
    } finally {
      setAiPending(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-lg bg-muted/40 p-3">
        <MessageSquareText className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
        <p className="text-xs text-muted-foreground">
          תבניות הודעה זמינות לכל הנציגים בקומפוזר הוואטסאפ — דרך כפתור התבניות או קיצור מקלדת
          (הקלדת <code dir="ltr">/קיצור</code> ורווח מרחיבה אוטומטית לגוף התבנית).
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1 flex-wrap">
          <button
            onClick={() => setCategoryFilter('all')}
            className={`text-xs px-2.5 py-1 rounded-full transition-colors ${
              categoryFilter === 'all' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/70'
            }`}
          >
            הכל
          </button>
          {CATEGORIES.map((c) => (
            <button
              key={c.value}
              onClick={() => setCategoryFilter(c.value)}
              className={`text-xs px-2.5 py-1 rounded-full transition-colors ${
                categoryFilter === c.value ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/70'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
        <Button size="sm" onClick={openCreate} className="gap-1.5">
          <Plus className="h-4 w-4" />
          תבנית חדשה
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-10 text-sm text-muted-foreground">אין תבניות בקטגוריה זו עדיין</div>
      ) : (
        <div className="space-y-2">
          {filtered.map((t) => (
            <div key={t.id} className={`flex items-start gap-3 rounded-xl border bg-card p-3 shadow-card ${!t.is_active ? 'opacity-60' : ''}`}>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm">{t.title}</span>
                  <Badge variant="secondary" className="text-[10px]">{CATEGORY_LABEL[t.category] || t.category}</Badge>
                  {t.shortcut && (
                    <Badge variant="outline" className="text-[10px] gap-1" dir="ltr">
                      <Zap className="h-2.5 w-2.5" />/{t.shortcut}
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1 truncate">{t.body}</p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <Switch
                  checked={t.is_active !== false}
                  onCheckedChange={(checked) => toggleActiveMutation.mutate({ id: t.id, is_active: checked })}
                  aria-label="פעיל"
                />
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(t)} aria-label="ערוך">
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" aria-label="מחק">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent dir="rtl">
                    <AlertDialogHeader>
                      <AlertDialogTitle>למחוק את התבנית "{t.title}"?</AlertDialogTitle>
                      <AlertDialogDescription>הפעולה אינה הפיכה. נציגים שמשתמשים בקיצור שלה לא יוכלו יותר.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>ביטול</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => deleteMutation.mutate(t.id)}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        כן, מחק
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={(open) => (open ? setDialogOpen(true) : closeDialog())}>
        <DialogContent dir="rtl" className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? 'עריכת תבנית' : 'תבנית חדשה'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>קטגוריה</Label>
                <Select value={form.category} onValueChange={(v) => setForm((f) => ({ ...f, category: v }))} dir="rtl">
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>סדר תצוגה</Label>
                <Input
                  type="number"
                  value={form.sort_order}
                  onChange={(e) => setForm((f) => ({ ...f, sort_order: e.target.value }))}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>כותרת</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="לדוגמה: פתיחה עם שם"
                required
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>גוף ההודעה</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={improveWithAI}
                  disabled={aiPending}
                  className="h-7 text-xs gap-1 text-primary"
                  title={hasDraft ? 'שפר את הטקסט שכתבת' : 'נסח טיוטה מהכותרת'}
                >
                  {aiPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  {hasDraft ? 'שפר עם AI' : 'נסח מהכותרת'}
                </Button>
              </div>
              <Textarea
                value={form.body}
                onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
                placeholder="היי {{שם}}, ..."
                rows={4}
                required
              />
              <div className="flex flex-wrap gap-1.5">
                {PLACEHOLDERS.map((ph) => (
                  <button
                    key={ph}
                    type="button"
                    onClick={() => insertPlaceholder(ph)}
                    className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground hover:bg-muted/70"
                    dir="ltr"
                  >
                    {ph}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>קיצור (אופציונלי)</Label>
              <Input
                value={form.shortcut}
                onChange={(e) => { setForm((f) => ({ ...f, shortcut: e.target.value })); setShortcutError(null); }}
                placeholder="מחיר1"
                dir="ltr"
              />
              {shortcutError ? (
                <p className="text-[11px] text-destructive">{shortcutError}</p>
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  הקלדת <code dir="ltr">/{form.shortcut || 'קיצור'}</code> ואז רווח בקומפוזר תרחיב אוטומטית לגוף ההודעה. ללא רווחים או "/".
                </p>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Switch checked={form.is_active} onCheckedChange={(v) => setForm((f) => ({ ...f, is_active: v }))} />
              <Label className="cursor-pointer" onClick={() => setForm((f) => ({ ...f, is_active: !f.is_active }))}>פעילה</Label>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeDialog}>ביטול</Button>
              <Button type="submit" disabled={saveMutation.isPending} className="gap-2">
                {saveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {editingId ? 'שמור שינויים' : 'צור תבנית'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
