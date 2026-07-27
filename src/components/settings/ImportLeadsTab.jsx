import React, { useMemo, useRef, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Upload, AlertCircle, CheckCircle2, FileSpreadsheet, RotateCcw, Download } from 'lucide-react';
import { toast } from 'sonner';
import { readFileToRows, parseImportDate } from '@/utils/importFile';
import { LEAD_STATUS_OPTIONS } from '@/constants/leadOptions';

// ─────────────────────────────────────────────────────────────────────────────
// Bulk lead import: CSV/Excel → staging table → one server-side SQL merge.
//
// Why not the existing Sheets importer: importLeadsFromSheets re-fetches the
// ENTIRE spreadsheet on every 50-row batch and creates rows one at a time from
// a React component (~4.4 rows/sec → ~3 hours for 50k with the tab open).
// Here the browser only PARSES and UPLOADS (bulk inserts of 500 rows into
// lead_import_rows); all the matching and writing happens inside
// process_lead_import(), so an interrupted run resumes from the table.
//
// Idempotency: external_id (the Kaveret row id) + external_source is a UNIQUE
// key on leads. Re-importing the same file UPDATES those leads instead of
// duplicating them.
// ─────────────────────────────────────────────────────────────────────────────

const UPLOAD_CHUNK  = 500;   // rows per insert request
const PROCESS_CHUNK = 500;   // rows per process_lead_import() call

// Canonical target fields. `aliases` drive header auto-detection — they are
// matched case-insensitively against the file's header row, so a Kaveret
// export maps itself on load and the user only fixes what it got wrong.
const FIELDS = [
  { key: 'external_id', label: 'מזהה כוורת', required: true,
    hint: 'המפתח לעדכון — שורה שחוזרת עם אותו מזהה תעדכן את הליד במקום ליצור חדש',
    aliases: ['id', 'lead id', 'leadid', 'מזהה', 'מזהה ליד', 'מספר ליד', 'קוד ליד', 'external id'] },
  { key: 'full_name', label: 'שם מלא', required: true,
    aliases: ['name', 'full name', 'fullname', 'שם', 'שם מלא', 'שם הליד', 'שם לקוח'] },
  { key: 'phone', label: 'טלפון', required: true,
    hint: 'כל פורמט — המערכת מנרמלת ל-972XXXXXXXXX ומאתרת לפיו איש קשר קיים',
    aliases: ['phone', 'mobile', 'telephone', 'טלפון', 'נייד', 'מספר טלפון', 'פלאפון'] },
  { key: 'email',        label: 'אימייל',        aliases: ['email', 'mail', 'אימייל', 'מייל', 'דוא"ל'] },
  { key: 'city',         label: 'עיר',           aliases: ['city', 'עיר', 'ישוב', 'יישוב'] },
  { key: 'address',      label: 'כתובת',         aliases: ['address', 'כתובת'] },
  { key: 'status',       label: 'סטטוס',         aliases: ['status', 'סטטוס', 'מצב'] },
  { key: 'source',       label: 'מקור',          aliases: ['source', 'מקור', 'ערוץ', 'מקור ליד'] },
  { key: 'created_date', label: 'תאריך יצירה',
    hint: 'נשמר כפי שהוא — הדוחות ההיסטוריים תלויים בו',
    aliases: ['date', 'created', 'created at', 'created date', 'תאריך', 'תאריך יצירה', 'תאריך כניסה'] },
  { key: 'rep1',         label: 'נציג (מייל)',    aliases: ['rep', 'agent', 'owner', 'נציג', 'משויך ל', 'אחראי'] },
  { key: 'notes',        label: 'הערות',         aliases: ['notes', 'note', 'comments', 'remark', 'הערות', 'הערה'] },
  { key: 'subject',      label: 'נושא',          aliases: ['subject', 'topic', 'נושא'] },
  { key: 'budget',       label: 'תקציב',         aliases: ['budget', 'תקציב'] },
  { key: 'preferred_product', label: 'מוצר מבוקש', aliases: ['product', 'מוצר', 'מוצר מבוקש'] },
  { key: 'utm_source',   label: 'UTM Source',    aliases: ['utm_source', 'utm source'] },
  { key: 'utm_medium',   label: 'UTM Medium',    aliases: ['utm_medium', 'utm medium'] },
  { key: 'utm_campaign', label: 'UTM Campaign',  aliases: ['utm_campaign', 'utm campaign', 'campaign', 'קמפיין'] },
  { key: 'utm_content',  label: 'UTM Content',   aliases: ['utm_content', 'utm content'] },
  { key: 'utm_term',     label: 'UTM Term',      aliases: ['utm_term', 'utm term'] },
  { key: 'landing_page', label: 'דף נחיתה',      aliases: ['landing_page', 'landing page', 'דף נחיתה', 'עמוד נחיתה'] },
];

const REQUIRED = FIELDS.filter((f) => f.required).map((f) => f.key);
const VALID_STATUSES = new Set(LEAD_STATUS_OPTIONS.map((s) => s.value));
const STATUS_BY_LABEL = new Map(LEAD_STATUS_OPTIONS.map((s) => [s.label.trim(), s.value]));

const norm = (s) => String(s || '').trim().toLowerCase().replace(/[_\-\s"']+/g, ' ');

// Best-effort header → field mapping so a Kaveret export lands pre-mapped.
function autoDetect(headers) {
  const mapping = {};
  const taken = new Set();
  for (const field of FIELDS) {
    const idx = headers.findIndex((h, i) => !taken.has(i) && field.aliases.some((a) => norm(a) === norm(h)));
    if (idx !== -1) { mapping[field.key] = idx; taken.add(idx); }
  }
  return mapping;
}

// Accepts the English key, the Hebrew label, or anything else (→ new_lead).
function normalizeStatus(raw) {
  const s = String(raw || '').trim();
  if (!s) return 'new_lead';
  if (VALID_STATUSES.has(s)) return s;
  return STATUS_BY_LABEL.get(s) || 'new_lead';
}

// DD/MM/YYYY (with or without a time part) → ISO. parseImportDate handles the
// date; the time is preserved when present so same-day ordering survives.
function toIsoDate(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const withTime = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (withTime) {
    const [, d, m, y, hh, mm, ss] = withTime;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T${hh.padStart(2, '0')}:${mm}:${ss || '00'}`;
  }
  const dateOnly = parseImportDate(s);
  if (dateOnly) return dateOnly;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

export default function ImportLeadsTab() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef(null);

  const [fileName, setFileName]   = useState('');
  const [headers, setHeaders]     = useState([]);
  const [rows, setRows]           = useState([]);
  const [mapping, setMapping]     = useState({});
  const [externalSource, setExternalSource] = useState('kaveret');
  const [phase, setPhase]         = useState('idle'); // idle|uploading|processing|done
  const [progress, setProgress]   = useState({ current: 0, total: 0, label: '' });
  const [result, setResult]       = useState(null);
  const [parseError, setParseError] = useState('');

  const { data: batches = [] } = useQuery({
    queryKey: ['lead-import-batches'],
    queryFn: async () => {
      const { data, error } = await base44.supabase
        .from('lead_import_batches')
        .select('*')
        .order('created_date', { ascending: false })
        .limit(10);
      if (error) throw error;
      return data || [];
    },
    refetchInterval: phase === 'processing' ? 3000 : false,
  });

  const missingRequired = useMemo(
    () => REQUIRED.filter((k) => mapping[k] === undefined || mapping[k] === null),
    [mapping]
  );

  const reset = () => {
    setFileName(''); setHeaders([]); setRows([]); setMapping({});
    setPhase('idle'); setProgress({ current: 0, total: 0, label: '' });
    setResult(null); setParseError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setParseError(''); setResult(null); setPhase('idle');
    setFileName(file.name);
    try {
      const all = await readFileToRows(file);
      if (all.length < 2) {
        setParseError('הקובץ ריק או מכיל רק שורת כותרות.');
        setHeaders([]); setRows([]);
        return;
      }
      const hdr = all[0].map((h) => String(h ?? '').trim());
      setHeaders(hdr);
      setRows(all.slice(1));
      setMapping(autoDetect(hdr));
    } catch (err) {
      console.error('[ImportLeadsTab] parse failed', err);
      setParseError(`קריאת הקובץ נכשלה: ${err?.message || 'פורמט לא נתמך'}`);
      setHeaders([]); setRows([]);
    }
  };

  // Build the canonical payload for one spreadsheet row. Empty values are
  // dropped so an empty cell never overwrites existing data on re-import.
  const buildPayload = (row) => {
    const out = {};
    for (const field of FIELDS) {
      const idx = mapping[field.key];
      if (idx === undefined || idx === null) continue;
      const raw = String(row[idx] ?? '').trim();
      if (!raw) continue;
      if (field.key === 'created_date') {
        const iso = toIsoDate(raw);
        if (iso) out.created_date = iso;
      } else if (field.key === 'status') {
        out.status = normalizeStatus(raw);
      } else if (field.key === 'rep1') {
        out.rep1 = raw.toLowerCase();
      } else {
        out[field.key] = raw;
      }
    }
    if (!out.status) out.status = 'new_lead';
    return out;
  };

  const runImport = async () => {
    if (missingRequired.length) {
      toast.error('חסר מיפוי לשדות חובה');
      return;
    }
    setResult(null);
    let batchId = null;

    try {
      // 1 — create the batch
      setPhase('uploading');
      setProgress({ current: 0, total: rows.length, label: 'מעלה שורות…' });

      const user = await base44.auth.me().catch(() => null);
      const { data: batch, error: batchErr } = await base44.supabase
        .from('lead_import_batches')
        .insert({
          file_name: fileName,
          external_source: externalSource.trim() || 'kaveret',
          uploaded_by: user?.email || null,
          mapping,
          total_rows: rows.length,
          status: 'uploading',
        })
        .select()
        .single();
      if (batchErr) throw batchErr;
      batchId = batch.id;

      // 2 — bulk-insert the raw rows into staging
      for (let i = 0; i < rows.length; i += UPLOAD_CHUNK) {
        const slice = rows.slice(i, i + UPLOAD_CHUNK).map((row, j) => ({
          batch_id: batchId,
          row_number: i + j + 2, // +2: 1-indexed, and row 1 is the header
          data: buildPayload(row),
        }));
        const { error } = await base44.supabase.from('lead_import_rows').insert(slice);
        if (error) throw error;
        setProgress({ current: Math.min(i + UPLOAD_CHUNK, rows.length), total: rows.length, label: 'מעלה שורות…' });
      }

      await base44.supabase.from('lead_import_batches').update({ status: 'ready' }).eq('id', batchId);

      // 3 — server-side merge, chunk by chunk. State lives in the table, so a
      //     closed tab loses progress display but not the import itself.
      setPhase('processing');
      setProgress({ current: 0, total: rows.length, label: 'מעבד ומקשר לאנשי קשר…' });

      const totals = {
        created_leads: 0, updated_leads: 0, failed_rows: 0,
        created_contacts: 0, matched_contacts: 0,
      };
      let processed = 0;
      for (;;) {
        const { data, error } = await base44.supabase.rpc('process_lead_import', {
          p_batch_id: batchId,
          p_chunk: PROCESS_CHUNK,
        });
        if (error) throw error;
        for (const k of Object.keys(totals)) totals[k] += data[k] || 0;
        processed += data.processed_now || 0;
        setProgress({ current: processed, total: rows.length, label: 'מעבד ומקשר לאנשי קשר…' });
        if (data.done || !data.processed_now) break;
      }

      setResult(totals);
      setPhase('done');
      toast.success(`הייבוא הושלם — ${totals.created_leads} לידים חדשים, ${totals.updated_leads} עודכנו`);
      queryClient.invalidateQueries({ queryKey: ['lead-import-batches'] });
      queryClient.invalidateQueries({ queryKey: ['leads'] });
    } catch (err) {
      console.error('[ImportLeadsTab] import failed', err);
      if (batchId) {
        await base44.supabase
          .from('lead_import_batches')
          .update({ status: 'failed', error: String(err?.message || err).slice(0, 500) })
          .eq('id', batchId)
          .catch(() => {});
      }
      setPhase('idle');
      toast.error(`הייבוא נכשל: ${err?.message || 'שגיאה לא צפויה'}`);
    }
  };

  const downloadErrors = async (batchId) => {
    const { data, error } = await base44.supabase
      .from('lead_import_rows')
      .select('row_number, error, data')
      .eq('batch_id', batchId)
      .eq('status', 'failed')
      .limit(5000);
    if (error) { toast.error('שליפת השגיאות נכשלה'); return; }
    if (!data?.length) { toast.info('אין שורות שנכשלו'); return; }
    const csv = ['שורה,שגיאה,שם,טלפון,מזהה']
      .concat(data.map((r) => [
        r.row_number,
        `"${String(r.error || '').replace(/"/g, '""')}"`,
        `"${String(r.data?.full_name || '').replace(/"/g, '""')}"`,
        `"${String(r.data?.phone || '')}"`,
        `"${String(r.data?.external_id || '')}"`,
      ].join(',')))
      .join('\n');
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = `import-errors-${batchId.slice(0, 8)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const busy = phase === 'uploading' || phase === 'processing';
  const pct = progress.total ? Math.round((progress.current / progress.total) * 100) : 0;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            ייבוא לידים מקובץ
          </CardTitle>
          <CardDescription>
            העלאת קובץ CSV / Excel (למשל ייצוא מכוורת). כל שורה מאתרת איש קשר קיים לפי הטלפון
            או יוצרת חדש, והליד מקושר אליו. שורה שחוזרת עם אותו <strong>מזהה כוורת</strong> מעדכנת
            את הליד הקיים במקום ליצור כפילות.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* ── step 1: file ── */}
          <div className="space-y-2">
            <Label htmlFor="lead-import-file">1. בחר קובץ</Label>
            <Input
              id="lead-import-file"
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={handleFile}
              disabled={busy}
            />
            {fileName && !parseError && (
              <p className="text-xs text-muted-foreground">
                {fileName} — <strong>{rows.length.toLocaleString('he-IL')}</strong> שורות,
                {' '}{headers.length} עמודות
              </p>
            )}
          </div>

          {parseError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{parseError}</AlertDescription>
            </Alert>
          )}

          {headers.length > 0 && (
            <>
              {/* ── step 2: source label ── */}
              <div className="space-y-2">
                <Label htmlFor="lead-import-source">2. מערכת המקור</Label>
                <Input
                  id="lead-import-source"
                  value={externalSource}
                  onChange={(e) => setExternalSource(e.target.value)}
                  disabled={busy}
                  className="max-w-xs"
                  dir="ltr"
                />
                <p className="text-xs text-muted-foreground">
                  יחד עם מזהה השורה זהו מפתח העדכון. השאר <code>kaveret</code> לייבוא מכוורת.
                </p>
              </div>

              {/* ── step 3: mapping ── */}
              <div className="space-y-3">
                <Label>3. מיפוי עמודות</Label>
                <p className="text-xs text-muted-foreground -mt-1">
                  זוהה אוטומטית לפי שמות העמודות. בדוק ותקן מה שצריך.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {FIELDS.map((field) => {
                    const missing = field.required &&
                      (mapping[field.key] === undefined || mapping[field.key] === null);
                    return (
                      <div key={field.key} className="space-y-1">
                        <Label className="text-xs font-normal flex items-center gap-1.5">
                          {field.label}
                          {field.required && <span className="text-destructive">*</span>}
                          {mapping[field.key] !== undefined && mapping[field.key] !== null && (
                            <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                          )}
                        </Label>
                        <Select
                          dir="rtl"
                          value={mapping[field.key] === undefined || mapping[field.key] === null
                            ? '__none__' : String(mapping[field.key])}
                          onValueChange={(v) => setMapping((m) => {
                            const next = { ...m };
                            if (v === '__none__') delete next[field.key];
                            else next[field.key] = Number(v);
                            return next;
                          })}
                          disabled={busy}
                        >
                          <SelectTrigger className={missing ? 'border-destructive' : ''}>
                            <SelectValue placeholder="— לא מיובא —" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">— לא מיובא —</SelectItem>
                            {headers.map((h, i) => (
                              <SelectItem key={i} value={String(i)}>{h || `עמודה ${i + 1}`}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {field.hint && (
                          <p className="text-[11px] leading-tight text-muted-foreground">{field.hint}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* ── preview ── */}
              {missingRequired.length === 0 && rows.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-xs">תצוגה מקדימה (3 שורות ראשונות)</Label>
                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/50">
                        <tr>
                          {['מזהה', 'שם', 'טלפון', 'סטטוס', 'תאריך'].map((h) => (
                            <th key={h} className="px-3 py-2 text-right font-medium whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.slice(0, 3).map((row, i) => {
                          const p = buildPayload(row);
                          return (
                            <tr key={i} className="border-t border-border">
                              <td className="px-3 py-2 whitespace-nowrap" dir="ltr">{p.external_id || '—'}</td>
                              <td className="px-3 py-2 whitespace-nowrap">{p.full_name || '—'}</td>
                              <td className="px-3 py-2 whitespace-nowrap" dir="ltr">{p.phone || '—'}</td>
                              <td className="px-3 py-2 whitespace-nowrap">{p.status}</td>
                              <td className="px-3 py-2 whitespace-nowrap" dir="ltr">{p.created_date || '—'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {missingRequired.length > 0 && (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    חסר מיפוי לשדות חובה:{' '}
                    {missingRequired.map((k) => FIELDS.find((f) => f.key === k)?.label).join(', ')}
                  </AlertDescription>
                </Alert>
              )}

              {/* ── progress ── */}
              {busy && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{progress.label}</span>
                    <span className="font-medium tabular-nums">
                      {progress.current.toLocaleString('he-IL')} / {progress.total.toLocaleString('he-IL')}
                    </span>
                  </div>
                  <Progress value={pct} />
                </div>
              )}

              {/* ── result ── */}
              {result && (
                <Alert>
                  <CheckCircle2 className="h-4 w-4" />
                  <AlertDescription>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Badge variant="outline">לידים חדשים: {result.created_leads.toLocaleString('he-IL')}</Badge>
                      <Badge variant="outline">לידים שעודכנו: {result.updated_leads.toLocaleString('he-IL')}</Badge>
                      <Badge variant="outline">אנשי קשר חדשים: {result.created_contacts.toLocaleString('he-IL')}</Badge>
                      <Badge variant="outline">שויכו לאנשי קשר קיימים: {result.matched_contacts.toLocaleString('he-IL')}</Badge>
                      {result.failed_rows > 0 && (
                        <Badge variant="destructive">נכשלו: {result.failed_rows.toLocaleString('he-IL')}</Badge>
                      )}
                    </div>
                  </AlertDescription>
                </Alert>
              )}

              <div className="flex gap-2">
                <Button onClick={runImport} disabled={busy || missingRequired.length > 0} className="gap-2">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  {busy ? 'מייבא…' : `ייבא ${rows.length.toLocaleString('he-IL')} שורות`}
                </Button>
                <Button variant="outline" onClick={reset} disabled={busy} className="gap-2">
                  <RotateCcw className="h-4 w-4" />
                  התחל מחדש
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ── history ── */}
      {batches.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">ייבואים אחרונים</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    {['קובץ', 'מקור', 'סטטוס', 'שורות', 'נוצרו', 'עודכנו', 'נכשלו', ''].map((h) => (
                      <th key={h} className="px-3 py-2 text-right font-medium whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {batches.map((b) => (
                    <tr key={b.id} className="border-t border-border">
                      <td className="px-3 py-2 max-w-[180px] truncate" title={b.file_name}>{b.file_name || '—'}</td>
                      <td className="px-3 py-2 whitespace-nowrap" dir="ltr">{b.external_source}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <Badge variant={b.status === 'done' ? 'outline' : b.status === 'failed' ? 'destructive' : 'secondary'}>
                          {{ uploading: 'מעלה', ready: 'ממתין', processing: 'מעבד', done: 'הושלם', failed: 'נכשל' }[b.status] || b.status}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 tabular-nums">{(b.total_rows || 0).toLocaleString('he-IL')}</td>
                      <td className="px-3 py-2 tabular-nums">{(b.created_leads || 0).toLocaleString('he-IL')}</td>
                      <td className="px-3 py-2 tabular-nums">{(b.updated_leads || 0).toLocaleString('he-IL')}</td>
                      <td className="px-3 py-2 tabular-nums">{(b.failed_rows || 0).toLocaleString('he-IL')}</td>
                      <td className="px-3 py-2">
                        {b.failed_rows > 0 && (
                          <Button variant="ghost" size="sm" className="gap-1.5 h-7" onClick={() => downloadErrors(b.id)}>
                            <Download className="h-3.5 w-3.5" />
                            שגיאות
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
