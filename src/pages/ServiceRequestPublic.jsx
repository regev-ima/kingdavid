import React, { useMemo, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, CheckCircle2, Crown, ShieldCheck } from 'lucide-react';
import ServicePhotoUploader from '@/components/service/ServicePhotoUploader';
import { compressImage } from '@/lib/imageCompression';
import {
  REQUEST_TYPE_OPTIONS, DIAGNOSTIC_QUESTIONS, CONTACT_PREFERENCE_OPTIONS,
} from '@/constants/serviceOptions';

// Public, unauthenticated self-service intake form. A customer reaches it from
// the SMS link (/service-request?token=...). It talks to the DB only through
// two SECURITY DEFINER RPCs scoped to the single ticket the token points at —
// no broad anon access. Mounted outside the app's auth gate (see App.jsx).
export default function ServiceRequestPublic() {
  const token = useMemo(() => new URLSearchParams(window.location.search).get('token'), []);

  const { data: info, isLoading } = useQuery({
    queryKey: ['public-service-request', token],
    enabled: !!token,
    queryFn: async () => {
      const { data, error } = await base44.supabase.rpc('service_request_get', { p_token: token });
      if (error) throw error;
      return data;
    },
  });

  const [form, setForm] = useState({
    request_type: '',
    order_date: '',
    warranty_years: '',
    complaint_age_months: '',
    description: '',
    contact_preference: 'phone',
    issue_answers: {},
    photo_urls: [],
  });
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));
  const setAnswer = (k, v) => setForm((p) => ({ ...p, issue_answers: { ...p.issue_answers, [k]: v } }));
  const [error, setError] = useState('');

  // Anon upload straight into the 'uploads' bucket under the service-requests/
  // prefix the storage policy whitelists for anonymous inserts.
  const publicUpload = async (file) => {
    const safeName = (file.name || 'photo.jpg').replace(/[^\w.\-]/g, '_');
    const path = `service-requests/${token}/${Date.now()}_${safeName}`;
    const { error: upErr } = await base44.supabase.storage.from('uploads').upload(path, file, { upsert: false });
    if (upErr) throw upErr;
    const { data } = base44.supabase.storage.from('uploads').getPublicUrl(path);
    return { file_url: data.publicUrl };
  };

  const submitMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        request_type: form.request_type,
        order_date: form.order_date || null,
        warranty_years: form.warranty_years || null,
        complaint_age_months: form.complaint_age_months || null,
        description: form.description,
        contact_preference: form.contact_preference,
        issue_answers: form.issue_answers,
        photo_urls: form.photo_urls,
        product_name: form.issue_answers.product || '',
      };
      const { data, error: rpcErr } = await base44.supabase.rpc('service_request_submit', { p_token: token, p_data: payload });
      if (rpcErr) throw rpcErr;
      if (data && data.ok === false) throw new Error('link_unavailable');
      return data;
    },
    onError: (err) => {
      console.error('[ServiceRequestPublic] submit failed', err);
      setError(err?.message === 'link_unavailable' ? 'הקישור כבר נוצל או אינו תקין.' : 'אירעה שגיאה בשליחה. נסו שוב.');
    },
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.request_type) return setError('יש לבחור סוג פנייה');
    if (!form.description.trim()) return setError('יש לתאר את הבעיה');
    setError('');
    submitMutation.mutate();
  };

  // ── Shell ────────────────────────────────────────────────────────────────
  const Shell = ({ children }) => (
    <div dir="rtl" className="min-h-screen bg-slate-50 flex flex-col">
      <header className="bg-gradient-to-l from-slate-900 to-slate-800 text-white py-6 px-4 text-center">
        <div className="inline-flex items-center gap-2">
          <div className="h-9 w-9 rounded-lg bg-amber-400/20 flex items-center justify-center"><Crown className="h-5 w-5 text-amber-400" /></div>
          <span className="text-xl font-bold">KING DAVID</span>
        </div>
        <p className="text-amber-400 text-sm mt-1">שירות לקוחות</p>
      </header>
      <main className="flex-1 w-full max-w-xl mx-auto p-4">{children}</main>
      <footer className="text-center text-xs text-muted-foreground py-4">מזרני קינג דוד · 1700-700-464</footer>
    </div>
  );

  if (!token) {
    return <Shell><div className="bg-white rounded-2xl border p-6 text-center text-muted-foreground mt-6">קישור לא תקין.</div></Shell>;
  }
  if (isLoading) {
    return <Shell><div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div></Shell>;
  }
  if (!info?.found || info?.already_submitted) {
    return (
      <Shell>
        <div className="bg-white rounded-2xl border p-6 text-center mt-6 space-y-2">
          <CheckCircle2 className="h-10 w-10 text-emerald-500 mx-auto" />
          <p className="font-medium">{info?.already_submitted ? 'הפנייה כבר נשלחה — תודה!' : 'הקישור אינו תקין או שפג תוקפו.'}</p>
          <p className="text-sm text-muted-foreground">צוות השירות יחזור אליכם בהקדם. לכל שאלה: 1700-700-464.</p>
        </div>
      </Shell>
    );
  }

  if (submitMutation.isSuccess) {
    return (
      <Shell>
        <div className="bg-white rounded-2xl border p-8 text-center mt-6 space-y-3">
          <CheckCircle2 className="h-12 w-12 text-emerald-500 mx-auto" />
          <h2 className="text-xl font-bold">תודה רבה!</h2>
          <p className="text-muted-foreground">פנייתך התקבלה. צוות שירות הלקוחות שלנו יחזור אליך בהקדם האפשרי.</p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="bg-white rounded-2xl border p-5 mt-4 space-y-5">
        <div>
          <h1 className="text-lg font-bold">פתיחת פניית שירות</h1>
          <p className="text-sm text-muted-foreground">
            שלום{info.customer_name ? ` ${info.customer_name}` : ''}, נשמח לעזור. אנא מלאו את הפרטים הבאים
            {info.order_number ? ` (הזמנה #${info.order_number})` : ''}.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Request type */}
          <div className="space-y-2">
            <Label>סוג הפנייה *</Label>
            <div className="grid grid-cols-1 gap-2">
              {REQUEST_TYPE_OPTIONS.map((opt) => {
                const selected = form.request_type === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => set('request_type', opt.value)}
                    className={`text-right rounded-xl border p-3 transition-all ${selected ? 'border-primary bg-primary/5 ring-2 ring-primary/30' : 'border-border hover:bg-muted/40'}`}
                  >
                    <div className="font-medium text-sm flex items-center gap-2">
                      <opt.Icon className={`h-4 w-4 shrink-0 ${selected ? 'text-primary' : 'text-muted-foreground'}`} />
                      {opt.label}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">{opt.description}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Order date */}
          <div className="space-y-1.5">
            <Label>מתי ביצעת את ההזמנה?</Label>
            <Input type="date" value={form.order_date} onChange={(e) => set('order_date', e.target.value)} />
          </div>

          {/* Warranty extra */}
          {form.request_type === 'warranty' && (
            <div className="grid grid-cols-2 gap-3 p-3 rounded-lg bg-emerald-50/60 border border-emerald-100">
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1 text-xs"><ShieldCheck className="h-3.5 w-3.5 text-emerald-600" /> שנות אחריות</Label>
                <Input type="number" min="0" placeholder="למשל 10" value={form.warranty_years} onChange={(e) => set('warranty_years', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">לפני כמה חודשים התחילה הבעיה?</Label>
                <Input type="number" min="0" placeholder="למשל 36" value={form.complaint_age_months} onChange={(e) => set('complaint_age_months', e.target.value)} />
              </div>
            </div>
          )}

          {/* Diagnostic questions */}
          <div className="space-y-3">
            {DIAGNOSTIC_QUESTIONS.map((q) => (
              <div key={q.key} className="space-y-1">
                <Label className="text-sm">{q.label}</Label>
                {q.type === 'select' ? (
                  <Select value={form.issue_answers[q.key] || ''} onValueChange={(v) => setAnswer(q.key, v)}>
                    <SelectTrigger><SelectValue placeholder="בחר..." /></SelectTrigger>
                    <SelectContent>{q.options.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
                  </Select>
                ) : q.type === 'textarea' ? (
                  <Textarea rows={2} value={form.issue_answers[q.key] || ''} onChange={(e) => setAnswer(q.key, e.target.value)} placeholder={q.placeholder} />
                ) : (
                  <Input value={form.issue_answers[q.key] || ''} onChange={(e) => setAnswer(q.key, e.target.value)} placeholder={q.placeholder} />
                )}
              </div>
            ))}
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label>תיאור הבעיה *</Label>
            <Textarea rows={3} value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="ספרו לנו מה קרה..." required />
          </div>

          {/* Photos */}
          <div className="space-y-1.5">
            <Label>צירוף תמונות של הבעיה</Label>
            <ServicePhotoUploader
              value={form.photo_urls}
              onChange={(urls) => set('photo_urls', urls)}
              uploadFn={async (file) => {
                const compressed = await compressImage(file, { maxSizeMB: 0.6, maxWidthOrHeight: 1600 });
                return publicUpload(compressed);
              }}
            />
          </div>

          {/* Contact preference */}
          <div className="space-y-1.5">
            <Label>איך תעדיפו שניצור קשר?</Label>
            <Select value={form.contact_preference} onValueChange={(v) => set('contact_preference', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{CONTACT_PREFERENCE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>

          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-sm">{error}</div>}

          <Button type="submit" className="w-full" disabled={submitMutation.isPending}>
            {submitMutation.isPending && <Loader2 className="h-4 w-4 me-2 animate-spin" />}
            שליחת הפנייה
          </Button>
        </form>
      </div>
    </Shell>
  );
}
