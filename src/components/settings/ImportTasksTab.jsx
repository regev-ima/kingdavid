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
import { Loader2, Upload, AlertCircle, CheckCircle2, FileSpreadsheet, RotateCcw, Download, ClipboardList } from 'lucide-react';
import { toast } from 'sonner';
import { readFileToRows } from '@/utils/importFile';
import { matchStatus, auditStatuses } from '@/lib/leadStatusMatch';
import { extractEmail, auditRepEmails } from '@/lib/repEmailExtract';
import { isMeetingStatus } from '@/constants/leadOptions';
import {
  isKaveretTaskExport, kaveretTaskMapping, kaveretTaskStatus, toWallClock,
} from '@/lib/kaveretTaskPreset';

// ─────────────────────────────────────────────────────────────────────────────
// Task history import: Kaveret's task export → sales_tasks, one row per task.
//
// Same shape as ImportLeadsTab: the browser only PARSES and UPLOADS (bulk
// inserts into task_import_rows); matching each row to its lead and writing
// the task happens inside process_task_import(), chunk by chunk, so an
// interrupted run resumes from the table.
//
// The lead is found by phone (Kaveret's "ליד id" column is empty in every
// export seen). A row whose phone matches no lead is reported as "ללא ליד" —
// it is a lead this CRM does not have, and the row is there to download and
// look at, not an error to hide.
// ─────────────────────────────────────────────────────────────────────────────

const UPLOAD_CHUNK  = 500;
const PROCESS_CHUNK = 300;

const FIELDS = [
  { key: 'phone',            label: 'טלפון (לאיתור הליד)', required: true },
  { key: 'phone_alt',        label: 'טלפון חלופי' },
  { key: 'full_name',        label: 'שם לקוח' },
  { key: 'external_lead_id', label: 'מזהה ליד בכוורת' },
  { key: 'created_at',       label: 'תאריך יצירת המשימה', required: true },
  { key: 'due_at',           label: 'תאריך לביצוע' },
  { key: 'rep1',             label: 'נציג (מייל)' },
  { key: 'status',           label: 'סטטוס הליד' },
  { key: 'task_status',      label: 'סטטוס המשימה' },
  { key: 'summary',          label: 'תוכן המשימה' },
];
const REQUIRED = FIELDS.filter((f) => f.required).map((f) => f.key);

const EMPTY_TOTALS = { created_tasks: 0, updated_tasks: 0, unmatched_rows: 0, failed_rows: 0 };

export default function ImportTasksTab() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef(null);

  const [fileName, setFileName]   = useState('');
  const [headers, setHeaders]     = useState([]);
  const [rows, setRows]           = useState([]);
  const [mapping, setMapping]     = useState({});
  const [isKaveret, setIsKaveret] = useState(false);
  const [parseError, setParseError] = useState('');
  const [phase, setPhase]         = useState('idle'); // idle | uploading | processing | done | failed
  const [progress, setProgress]   = useState({ current: 0, total: 0, label: '' });
  const [running, setRunning]     = useState({ ...EMPTY_TOTALS });
  const [result, setResult]       = useState(null);
  const [batchId, setBatchId]     = useState(null);

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => base44.entities.User.list(),
    staleTime: 5 * 60_000,
  });

  const { data: batches = [] } = useQuery({
    queryKey: ['task-import-batches'],
    queryFn: async () => {
      const { data, error } = await base44.supabase
        .from('task_import_batches')
        .select('*')
        .order('created_date', { ascending: false })
        .limit(8);
      if (error) throw error;
      return data || [];
    },
    staleTime: 30_000,
  });

  const col = (key) => (mapping[key] === undefined || mapping[key] === null ? null : mapping[key]);
  const cell = (row, key) => { const i = col(key); return i == null ? '' : String(row[i] ?? '').trim(); };

  const missingRequired = useMemo(
    () => REQUIRED.filter((k) => col(k) == null),
    [mapping],
  );

  // ── Audits: what the file holds, before anything is written ──
  const audit = useMemo(() => {
    if (!rows.length) return null;
    const noPhone = rows.filter((r) => !cell(r, 'phone') && !cell(r, 'phone_alt')).length;
    const noDate  = col('created_at') == null ? rows.length : rows.filter((r) => !toWallClock(cell(r, 'created_at'))).length;
    const statuses = col('status') != null ? auditStatuses(rows.map((r) => cell(r, 'status'))) : null;
    const reps = col('rep1') != null ? auditRepEmails(rows.map((r) => cell(r, 'rep1')), users.map((u) => u.email)) : null;
    const taskStatus = new Map();
    if (col('task_status') != null) {
      for (const r of rows) {
        const raw = cell(r, 'task_status') || '(ריק)';
        const v = kaveretTaskStatus(raw);
        const key = `${raw} → ${v === 'completed' ? 'בוצעה' : 'פתוחה'}`;
        taskStatus.set(key, (taskStatus.get(key) || 0) + 1);
      }
    }
    return { noPhone, noDate, statuses, reps, taskStatus: [...taskStatus.entries()] };
  }, [rows, mapping, users]);

  const reset = () => {
    setFileName(''); setHeaders([]); setRows([]); setMapping({}); setIsKaveret(false);
    setParseError(''); setPhase('idle'); setProgress({ current: 0, total: 0, label: '' });
    setRunning({ ...EMPTY_TOTALS }); setResult(null); setBatchId(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setParseError(''); setResult(null); setPhase('idle'); setBatchId(null);
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
      setRows(all.slice(1).filter((r) => r.some((c) => String(c ?? '').trim() !== '')));
      const kaveret = isKaveretTaskExport(hdr);
      setIsKaveret(kaveret);
      setMapping(kaveret ? kaveretTaskMapping(hdr) : {});
    } catch (err) {
      console.error('[ImportTasksTab] parse failed', err);
      setParseError(`קריאת הקובץ נכשלה: ${err?.message || 'פורמט לא נתמך'}`);
      setHeaders([]); setRows([]);
    }
  };

  // One row → the payload process_task_import() reads. Dates stay wall-clock
  // strings (the server localises them); the rep blob becomes an address; the
  // lead status label becomes a CRM key, or nothing when it is unknown.
  const buildPayload = (row) => {
    const status = matchStatus(cell(row, 'status'));
    const out = {
      phone:            cell(row, 'phone') || cell(row, 'phone_alt'),
      full_name:        cell(row, 'full_name'),
      external_lead_id: cell(row, 'external_lead_id'),
      created_at:       toWallClock(cell(row, 'created_at')),
      due_at:           toWallClock(cell(row, 'due_at')),
      rep1:             extractEmail(cell(row, 'rep1')) || '',
      status:           status || '',
      task_status:      kaveretTaskStatus(cell(row, 'task_status')),
      task_type:        isMeetingStatus(status) ? 'meeting' : 'call',
      summary:          cell(row, 'summary'),
    };
    for (const k of Object.keys(out)) if (out[k] === '' || out[k] == null) delete out[k];
    return out;
  };

  // The server-side loop. Every returned chunk is already committed, so an
  // interrupted run resumes from where it stopped — this is also what
  // "המשך עיבוד" on an older batch calls.
  const processBatch = async (id, total) => {
    setPhase('processing');
    setProgress({ current: 0, total, label: 'מאתר לידים וכותב משימות…' });
    const totals = { ...EMPTY_TOTALS };
    setRunning({ ...totals });
    let processed = 0;
    for (;;) {
      const { data, error } = await base44.supabase.rpc('process_task_import', {
        p_batch_id: id,
        p_chunk: PROCESS_CHUNK,
      });
      if (error) throw error;
      for (const k of Object.keys(totals)) totals[k] += data[k] || 0;
      processed += data.processed_now || 0;
      setRunning({ ...totals });
      setProgress({ current: processed, total, label: 'מאתר לידים וכותב משימות…' });
      if (data.done || !data.processed_now) break;
    }
    return totals;
  };

  const finish = (totals) => {
    setResult(totals);
    setPhase('done');
    toast.success(`הייבוא הושלם — ${totals.created_tasks.toLocaleString('he-IL')} משימות חדשות, ${totals.updated_tasks.toLocaleString('he-IL')} עודכנו`);
    queryClient.invalidateQueries({ queryKey: ['task-import-batches'] });
    queryClient.invalidateQueries({ queryKey: ['salesTasks'] });
    queryClient.invalidateQueries({ queryKey: ['sales-tasks'] });
  };

  const runImport = async () => {
    if (missingRequired.length) { toast.error('חסר מיפוי לשדות חובה'); return; }
    setResult(null);
    let id = null;
    try {
      setPhase('uploading');
      setProgress({ current: 0, total: rows.length, label: 'מעלה שורות…' });
      const user = await base44.auth.me().catch(() => null);
      const { data: batch, error: batchErr } = await base44.supabase
        .from('task_import_batches')
        .insert({
          file_name: fileName,
          external_source: 'kaveret',
          uploaded_by: user?.email || null,
          mapping,
          total_rows: rows.length,
          status: 'uploading',
        })
        .select()
        .single();
      if (batchErr) throw batchErr;
      id = batch.id;
      setBatchId(id);

      for (let i = 0; i < rows.length; i += UPLOAD_CHUNK) {
        const slice = rows.slice(i, i + UPLOAD_CHUNK).map((row, j) => ({
          batch_id: id,
          row_number: i + j + 2,
          data: buildPayload(row),
        }));
        const { error } = await base44.supabase.from('task_import_rows').insert(slice);
        if (error) throw error;
        setProgress({ current: Math.min(i + UPLOAD_CHUNK, rows.length), total: rows.length, label: 'מעלה שורות…' });
      }
      await base44.supabase.from('task_import_batches').update({ status: 'ready' }).eq('id', id);

      finish(await processBatch(id, rows.length));
    } catch (err) {
      console.error('[ImportTasksTab] import failed', err);
      if (id) {
        await base44.supabase
          .from('task_import_batches')
          .update({ status: 'failed', error: String(err?.message || err).slice(0, 500) })
          .eq('id', id)
          .catch(() => {});
      }
      setPhase('failed');
      toast.error(`הייבוא נכשל: ${err?.message || 'שגיאה לא ידועה'}`);
    }
  };

  const resumeBatch = async (b) => {
    setResult(null); setBatchId(b.id);
    try {
      finish(await processBatch(b.id, Math.max(0, (b.total_rows || 0) - (b.processed_rows || 0))));
    } catch (err) {
      console.error('[ImportTasksTab] resume failed', err);
      setPhase('failed');
      toast.error(`המשך העיבוד נכשל: ${err?.message || 'שגיאה לא ידועה'}`);
    }
  };

  // The rows that did not become a task, as a file: the unmatched ones are
  // leads Kaveret has and this CRM does not, and that list is the operator's
  // next job.
  const downloadProblems = async (id) => {
    const { data, error } = await base44.supabase
      .from('task_import_rows')
      .select('row_number,status,error,data')
      .eq('batch_id', id)
      .in('status', ['unmatched', 'failed'])
      .order('row_number')
      .limit(20000);
    if (error) { toast.error(`הורדה נכשלה: ${error.message}`); return; }
    if (!data?.length) { toast.info('אין שורות בעייתיות בייבוא הזה'); return; }
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [
      ['שורה', 'מצב', 'שגיאה', 'טלפון', 'שם לקוח', 'תאריך יצירה', 'תוכן המשימה'].map(esc).join(','),
      ...data.map((r) => [
        r.row_number, r.status === 'unmatched' ? 'ללא ליד' : 'נכשל', r.error,
        r.data?.phone, r.data?.full_name, r.data?.created_at, r.data?.summary,
      ].map(esc).join(',')),
    ];
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `task-import-problems-${id.slice(0, 8)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const busy = phase === 'uploading' || phase === 'processing';
  const pct = progress.total ? Math.round((progress.current / progress.total) * 100) : 0;
  const fmt = (n) => Number(n || 0).toLocaleString('he-IL');

  return (
    <div className="space-y-6" dir="rtl">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5" />
            ייבוא היסטוריית משימות מכוורת
          </CardTitle>
          <CardDescription>
            קובץ יצוא המשימות של כוורת (CSV / Excel) — כל שורה הופכת למשימה בכרטיס הליד, עם תאריך יצירה,
            תאריך לביצוע, סטטוס, נציג ותוכן. הליד מאותר לפי טלפון. הרצה חוזרת של אותו קובץ מעדכנת ולא מכפילה.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            <Input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={handleFile}
              disabled={busy}
              className="max-w-sm"
            />
            {fileName ? (
              <span className="text-sm text-muted-foreground flex items-center gap-1.5">
                <FileSpreadsheet className="h-4 w-4" />
                {fileName} · {fmt(rows.length)} שורות
              </span>
            ) : null}
            {isKaveret ? <Badge variant="secondary">זוהה יצוא משימות מכוורת — המיפוי הוחל</Badge> : null}
            {fileName && !busy ? (
              <Button variant="ghost" size="sm" onClick={reset}><RotateCcw className="h-4 w-4 me-1" />נקה</Button>
            ) : null}
          </div>

          {parseError ? (
            <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertDescription>{parseError}</AlertDescription></Alert>
          ) : null}

          {headers.length > 0 ? (
            <>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {FIELDS.map((field) => {
                  const missing = field.required && col(field.key) == null;
                  return (
                    <div key={field.key} className="space-y-1">
                      <Label className={`text-xs ${missing ? 'text-destructive' : 'text-muted-foreground'}`}>
                        {field.label}{field.required ? ' *' : ''}
                      </Label>
                      <Select
                        value={col(field.key) == null ? '__none__' : String(col(field.key))}
                        onValueChange={(v) => setMapping((m) => ({ ...m, [field.key]: v === '__none__' ? null : Number(v) }))}
                        disabled={busy}
                      >
                        <SelectTrigger className="h-9"><SelectValue placeholder="בחר עמודה" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">— לא ממופה —</SelectItem>
                          {headers.map((h, i) => (
                            <SelectItem key={i} value={String(i)}>{h || `עמודה ${i + 1}`}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  );
                })}
              </div>

              {audit ? (
                <div className="rounded-lg border bg-muted/40 p-3 text-sm space-y-2">
                  <p className="font-medium">בדיקה לפני ייבוא</p>
                  <ul className="list-disc ps-5 space-y-1 text-[13px]">
                    <li>{fmt(rows.length)} שורות בקובץ.</li>
                    {audit.noPhone > 0 ? (
                      <li className="text-amber-700">{fmt(audit.noPhone)} שורות ללא טלפון — לא יאותר להן ליד ויסומנו "ללא ליד".</li>
                    ) : null}
                    {audit.noDate > 0 ? (
                      <li className="text-amber-700">{fmt(audit.noDate)} שורות ללא תאריך יצירה קריא — ייווצרו עם תאריך היום.</li>
                    ) : null}
                    {audit.taskStatus.length ? (
                      <li>סטטוס משימה: {audit.taskStatus.map(([k, n]) => `${k} (${fmt(n)})`).join(' · ')}</li>
                    ) : null}
                    {audit.statuses?.unmatched?.length ? (
                      <li className="text-amber-700">
                        סטטוסי ליד שלא זוהו (המשימה תישמר בלי סטטוס):{' '}
                        {audit.statuses.unmatched.slice(0, 8).map((s) => `"${s.raw}" (${fmt(s.count)})`).join(' · ')}
                        {audit.statuses.unmatched.length > 8 ? ' …' : ''}
                      </li>
                    ) : null}
                    {audit.reps ? (
                      <li>
                        נציגים בקובץ: {fmt(audit.reps.rows?.length ?? 0)}
                        {audit.reps.unmatched?.length
                          ? <span className="text-amber-700"> · לא קיימים כמשתמשים: {audit.reps.unmatched.map((r) => r.email).join(', ')}</span>
                          : null}
                      </li>
                    ) : null}
                  </ul>
                </div>
              ) : null}

              {missingRequired.length ? (
                <p className="text-xs text-destructive">
                  חסר מיפוי: {missingRequired.map((k) => FIELDS.find((f) => f.key === k)?.label).join(', ')}
                </p>
              ) : null}

              <div className="flex items-center gap-3">
                <Button onClick={runImport} disabled={busy || missingRequired.length > 0 || rows.length === 0}>
                  {busy ? <Loader2 className="h-4 w-4 me-2 animate-spin" /> : <Upload className="h-4 w-4 me-2" />}
                  {busy ? progress.label : `ייבא ${fmt(rows.length)} משימות`}
                </Button>
              </div>
            </>
          ) : null}

          {busy || phase === 'done' || phase === 'failed' ? (
            <div className="space-y-2">
              <Progress value={pct} />
              <p className="text-xs text-muted-foreground">
                {fmt(progress.current)} / {fmt(progress.total)}
                {phase === 'processing' || phase === 'done' ? (
                  <> · {fmt(running.created_tasks)} נוצרו · {fmt(running.updated_tasks)} עודכנו · {fmt(running.unmatched_rows)} ללא ליד · {fmt(running.failed_rows)} נכשלו</>
                ) : null}
              </p>
            </div>
          ) : null}

          {result ? (
            <Alert>
              <CheckCircle2 className="h-4 w-4" />
              <AlertDescription className="space-y-2">
                <p>
                  הייבוא הסתיים: {fmt(result.created_tasks)} משימות חדשות, {fmt(result.updated_tasks)} עודכנו,{' '}
                  {fmt(result.unmatched_rows)} שורות ללא ליד תואם, {fmt(result.failed_rows)} נכשלו.
                </p>
                {batchId && (result.unmatched_rows > 0 || result.failed_rows > 0) ? (
                  <Button variant="outline" size="sm" onClick={() => downloadProblems(batchId)}>
                    <Download className="h-4 w-4 me-1.5" />הורד את השורות שלא נקלטו (CSV)
                  </Button>
                ) : null}
              </AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      {batches.length ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">ייבואים אחרונים</CardTitle>
            <CardDescription>ייבוא שנעצר באמצע ממשיך מהמקום שבו עצר.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {batches.map((b) => {
                const pending = (b.total_rows || 0) - (b.processed_rows || 0);
                const when = b.created_date ? new Date(b.created_date).toLocaleString('he-IL') : '';
                return (
                  <li key={b.id} className="py-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                    <div className="min-w-0">
                      <span className="font-medium">{b.file_name || b.id.slice(0, 8)}</span>
                      <span className="text-muted-foreground"> · {when} · {fmt(b.total_rows)} שורות</span>
                      <div className="text-xs text-muted-foreground">
                        {fmt(b.created_tasks)} נוצרו · {fmt(b.updated_tasks)} עודכנו · {fmt(b.unmatched_rows)} ללא ליד · {fmt(b.failed_rows)} נכשלו
                        {' · '}<Badge variant={b.status === 'done' ? 'secondary' : 'outline'} className="text-[10px]">{b.status}</Badge>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {b.status !== 'done' && pending > 0 ? (
                        <Button variant="outline" size="sm" disabled={busy} onClick={() => resumeBatch(b)}>המשך עיבוד ({fmt(pending)})</Button>
                      ) : null}
                      {(b.unmatched_rows > 0 || b.failed_rows > 0) ? (
                        <Button variant="ghost" size="sm" onClick={() => downloadProblems(b.id)}><Download className="h-4 w-4" /></Button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
