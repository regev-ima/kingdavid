import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
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
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, Upload, AlertCircle, CheckCircle2, FileSpreadsheet, RotateCcw, Download, ClipboardList, ExternalLink, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { readFileToRows } from '@/utils/importFile';
import { matchStatus, auditStatuses } from '@/lib/leadStatusMatch';
import { extractEmail, auditRepEmails } from '@/lib/repEmailExtract';
import { isMeetingStatus, LEAD_STATUS_OPTIONS } from '@/constants/leadOptions';
import { normalizeIsraeliPhone } from '@/utils/phoneUtils';
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

  // Reps in the file who are no longer users here. Their DONE tasks keep the
  // address they were done under — that is history. Their OPEN tasks have to
  // land in a queue someone reads: the lead's current owner here, or else
  // this fallback. The switch moves the done ones too, for an operator who
  // would rather see one name than a departed one.
  const knownEmails = useMemo(
    () => new Set(users.map((u) => String(u.email || '').toLowerCase()).filter(Boolean)),
    [users],
  );
  const [unknownRepTo, setUnknownRepTo] = useState('');
  const [moveCompletedToo, setMoveCompletedToo] = useState(false);
  useEffect(() => {
    if (unknownRepTo || !users.length) return;
    const preferred = users.find((u) => String(u.email || '').toLowerCase() === 'yonikd01@gmail.com');
    const admin = users.find((u) => u.role === 'admin');
    setUnknownRepTo(String((preferred || admin || users[0])?.email || '').toLowerCase());
  }, [users, unknownRepTo]);
  const repIsUnknown = (email) => Boolean(email) && !knownEmails.has(email);

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

  // ── Preview: which lead each row will land on, before anything is written ──
  // The same rule process_task_import() applies, run here against the live
  // leads so the operator sees the match and not just a count: by phone
  // (normalized both sides), name-matched first, then the newest.
  const [preview, setPreview] = useState(null); // { rows: [{ i, lead, how }], loading }
  const previewRows = useMemo(() => {
    if (!rows.length || col('phone') == null) return [];
    return rows.map((r, i) => ({
      i,
      phone: cell(r, 'phone') || cell(r, 'phone_alt'),
      name: cell(r, 'full_name'),
      created: toWallClock(cell(r, 'created_at')),
      due: toWallClock(cell(r, 'due_at')),
      taskStatus: kaveretTaskStatus(cell(r, 'task_status')),
      status: matchStatus(cell(r, 'status')),
      summary: cell(r, 'summary'),
      rep: extractEmail(cell(r, 'rep1')) || '',
    }));
  }, [rows, mapping]);

  // The same rule process_task_import() applies to a rep who is not a user.
  const effectiveRep = (r, lead) => {
    if (!repIsUnknown(r.rep)) return { rep: r.rep, moved: false };
    if (r.taskStatus !== 'not_completed' && !moveCompletedToo) return { rep: r.rep, moved: false };
    const to = String(lead?.rep1 || '').toLowerCase() || unknownRepTo || r.rep;
    return { rep: to, moved: to !== r.rep, from: r.rep };
  };

  useEffect(() => {
    if (!previewRows.length) { setPreview(null); return; }
    let cancelled = false;
    (async () => {
      setPreview({ rows: [], loading: true });
      const norms = [...new Set(previewRows.map((r) => normalizeIsraeliPhone(r.phone)).filter(Boolean))];
      const byNorm = new Map();
      for (let i = 0; i < norms.length; i += 200) {
        const { data, error } = await base44.supabase
          .from('leads')
          .select('id,full_name,phone,phone_normalized,status,rep1,created_date')
          .in('phone_normalized', norms.slice(i, i + 200));
        if (error) { console.error('[ImportTasksTab] preview lookup failed', error); break; }
        for (const l of data || []) {
          if (!byNorm.has(l.phone_normalized)) byNorm.set(l.phone_normalized, []);
          byNorm.get(l.phone_normalized).push(l);
        }
      }
      if (cancelled) return;
      const out = previewRows.map((r) => {
        const cands = byNorm.get(normalizeIsraeliPhone(r.phone)) || [];
        if (!cands.length) return { ...r, lead: null, how: r.phone ? 'none' : 'nophone', ...effectiveRep(r, null) };
        const byName = r.name ? cands.filter((l) => String(l.full_name || '').includes(r.name)) : [];
        const pool = byName.length ? byName : cands;
        const lead = [...pool].sort((a, b) => new Date(b.created_date || 0) - new Date(a.created_date || 0))[0];
        return { ...r, lead, how: byName.length ? 'name' : (cands.length > 1 ? 'phone-multi' : 'phone'), ...effectiveRep(r, lead) };
      });
      setPreview({ rows: out, loading: false });
    })();
    return () => { cancelled = true; };
    // effectiveRep reads unknownRepTo / moveCompletedToo / knownEmails, so a
    // change to any of them re-runs the preview with the new rule.
  }, [previewRows, unknownRepTo, moveCompletedToo, knownEmails]);

  const reset = () => {
    setPreview(null);
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
    if (repIsUnknown(out.rep1)) {
      out.rep_unknown = 'true';
      out.rep_fallback = unknownRepTo;
      if (moveCompletedToo) out.rep_move_completed = 'true';
    }
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

  // What the server actually did with each row — read back from staging so
  // the operator sees row → lead → task, not just four numbers.
  const [outcome, setOutcome] = useState(null);
  const loadOutcome = async (id) => {
    const { data, error } = await base44.supabase
      .from('task_import_rows')
      .select('row_number,status,error,lead_id,task_id,data')
      .eq('batch_id', id)
      .order('row_number')
      .limit(2000);
    if (error) { console.error('[ImportTasksTab] outcome load failed', error); return; }
    const leadIds = [...new Set((data || []).map((r) => r.lead_id).filter(Boolean))];
    const leads = new Map();
    for (let i = 0; i < leadIds.length; i += 200) {
      const { data: ls } = await base44.supabase
        .from('leads').select('id,full_name,phone').in('id', leadIds.slice(i, i + 200));
      for (const l of ls || []) leads.set(l.id, l);
    }
    setOutcome({ batchId: id, rows: (data || []).map((r) => ({ ...r, lead: r.lead_id ? leads.get(r.lead_id) : null })) });
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
    setResult(null); setOutcome(null);
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
      await loadOutcome(id);
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

  // Undo one batch: created tasks are deleted, updated tasks restored from
  // the snapshot the import took before overwriting them. Two clicks — the
  // second one names what is about to go — and chunked like the import, so a
  // closed tab leaves the batch half undone and "בטל ייבוא" finishes it.
  const [confirmRollback, setConfirmRollback] = useState(null); // batch id
  const [rollingBack, setRollingBack] = useState(null);         // batch id
  const rollbackBatch = async (b) => {
    setConfirmRollback(null);
    setRollingBack(b.id);
    const totals = { deleted_tasks: 0, restored_tasks: 0, skipped_rows: 0, failed_rows: 0 };
    try {
      for (;;) {
        const { data, error } = await base44.supabase.rpc('rollback_task_import', {
          p_batch_id: b.id,
          p_chunk: PROCESS_CHUNK,
        });
        if (error) throw error;
        for (const k of Object.keys(totals)) totals[k] += data[k] || 0;
        if (data.done || !data.processed_now) break;
      }
      toast.success(
        `הייבוא בוטל — ${fmt(totals.deleted_tasks)} משימות נמחקו, ${fmt(totals.restored_tasks)} שוחזרו`
        + (totals.skipped_rows ? `, ${fmt(totals.skipped_rows)} דולגו` : '')
        + (totals.failed_rows ? `, ${fmt(totals.failed_rows)} נכשלו` : ''),
      );
      queryClient.invalidateQueries({ queryKey: ['task-import-batches'] });
      queryClient.invalidateQueries({ queryKey: ['salesTasks'] });
      queryClient.invalidateQueries({ queryKey: ['sales-tasks'] });
      if (outcome?.batchId === b.id) await loadOutcome(b.id);
      if (batchId === b.id) { setResult(null); setPhase('idle'); }
    } catch (err) {
      console.error('[ImportTasksTab] rollback failed', err);
      toast.error(`ביטול הייבוא נכשל: ${err?.message || 'שגיאה לא ידועה'}`);
    } finally {
      setRollingBack(null);
    }
  };

  const resumeBatch = async (b) => {
    setResult(null); setBatchId(b.id);
    try {
      finish(await processBatch(b.id, Math.max(0, (b.total_rows || 0) - (b.processed_rows || 0))));
      await loadOutcome(b.id);
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
                        {audit.reps.unmatched?.length ? (
                          <>
                            <span className="text-amber-700"> · {fmt(audit.reps.unmatched.length)} אינם משתמשים במערכת</span>
                            {' — '}
                            {moveCompletedToo ? 'כל המשימות שלהם' : 'המשימות הפתוחות שלהם'} יעברו לנציג שמטפל היום בליד, ואם אין כזה ל־
                            <span dir="ltr" className="font-mono">{unknownRepTo || '(לא נבחר)'}</span>.
                            {moveCompletedToo ? '' : ' משימות שבוצעו נשארות על שם הנציג המקורי.'}
                          </>
                        ) : null}
                      </li>
                    ) : null}
                  </ul>
                  {audit.reps?.unmatched?.length ? (
                    <div className="flex flex-wrap items-end gap-4 pt-2 border-t border-border/50">
                      <div className="space-y-1 min-w-[16rem]">
                        <Label className="text-xs text-muted-foreground">נציג ברירת מחדל לנציגים שאינם במערכת</Label>
                        <Select value={unknownRepTo || '__none__'} onValueChange={(v) => setUnknownRepTo(v === '__none__' ? '' : v)} disabled={busy}>
                          <SelectTrigger className="h-9"><SelectValue placeholder="בחר נציג" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">— להשאיר את המייל המקורי —</SelectItem>
                            {users.filter((u) => u.email).map((u) => (
                              <SelectItem key={u.email} value={String(u.email).toLowerCase()}>{u.full_name || u.email}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <label className="flex items-center gap-2 text-xs pb-2 cursor-pointer">
                        <Checkbox checked={moveCompletedToo} onCheckedChange={(v) => setMoveCompletedToo(Boolean(v))} disabled={busy} />
                        להעביר גם משימות שבוצעו (ההיסטוריה תציג את הנציג החדש)
                      </label>
                      <details className="text-xs text-muted-foreground w-full">
                        <summary className="cursor-pointer">הכתובות שאינן במערכת ({fmt(audit.reps.unmatched.length)})</summary>
                        <p dir="ltr" className="font-mono mt-1 break-all">{audit.reps.unmatched.map((r) => `${r.email} (${r.count})`).join(', ')}</p>
                      </details>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {preview ? (
                <MatchTable
                  title="למי כל שורה תשויך"
                  loading={preview.loading}
                  rows={preview.rows}
                  summary={preview.loading ? null : {
                    matched: preview.rows.filter((r) => r.lead).length,
                    unmatched: preview.rows.filter((r) => !r.lead).length,
                  }}
                />
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

      {outcome ? (
        <Card>
          <CardContent className="pt-5">
            <MatchTable
              title="מה נקלט בפועל"
              rows={outcome.rows.map((r) => ({
                i: (r.row_number || 2) - 2,
                phone: r.data?.phone || '',
                name: r.data?.full_name || '',
                created: r.data?.created_at || '',
                due: r.data?.due_at || '',
                taskStatus: r.data?.task_status || 'not_completed',
                status: r.data?.status || null,
                summary: r.data?.summary || '',
                rep: r.data?.rep1 || '',
                lead: r.lead || null,
                how: r.status === 'created' ? 'created' : r.status === 'updated' ? 'updated'
                  : r.status === 'unmatched' ? 'none' : r.status === 'failed' ? 'failed'
                    : r.status === 'rolled_back' ? 'rolled_back' : 'pending',
                error: r.error,
              }))}
              summary={{
                matched: outcome.rows.filter((r) => r.status === 'created' || r.status === 'updated').length,
                unmatched: outcome.rows.filter((r) => r.status === 'unmatched' || r.status === 'failed').length,
              }}
            />
          </CardContent>
        </Card>
      ) : null}

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
                const written = (b.created_tasks || 0) + (b.updated_tasks || 0);
                const canRollback = written > 0 && !['rolled_back', 'rolling_back', 'uploading'].includes(b.status) && !busy;
                const isRolling = rollingBack === b.id;
                return (
                  <li key={b.id} className="py-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                    <div className="min-w-0">
                      <span className="font-medium">{b.file_name || b.id.slice(0, 8)}</span>
                      <span className="text-muted-foreground"> · {when} · {fmt(b.total_rows)} שורות</span>
                      <div className="text-xs text-muted-foreground">
                        {fmt(b.created_tasks)} נוצרו · {fmt(b.updated_tasks)} עודכנו · {fmt(b.unmatched_rows)} ללא ליד · {fmt(b.failed_rows)} נכשלו
                        {' · '}<Badge variant={b.status === 'done' ? 'secondary' : 'outline'} className="text-[10px]">{BATCH_STATUS_LABEL[b.status] || b.status}</Badge>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {confirmRollback === b.id ? (
                        <span className="flex items-center gap-2 text-xs">
                          <span className="text-destructive">
                            למחוק {fmt(b.created_tasks)} משימות שנוצרו ולשחזר {fmt(b.updated_tasks)} שעודכנו?
                          </span>
                          <Button variant="destructive" size="sm" onClick={() => rollbackBatch(b)}>כן, בטל ייבוא</Button>
                          <Button variant="ghost" size="sm" onClick={() => setConfirmRollback(null)}>לא</Button>
                        </span>
                      ) : (canRollback || isRolling) ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-destructive border-destructive/40 hover:bg-destructive/10"
                          disabled={isRolling || rollingBack != null}
                          onClick={() => setConfirmRollback(b.id)}
                        >
                          {isRolling ? <Loader2 className="h-4 w-4 me-1 animate-spin" /> : <Undo2 className="h-4 w-4 me-1" />}
                          {isRolling ? 'מבטל…' : 'בטל ייבוא'}
                        </Button>
                      ) : null}
                      {b.status !== 'done' && b.status !== 'rolled_back' && b.status !== 'rolling_back' && pending > 0 ? (
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

const BATCH_STATUS_LABEL = {
  uploading: 'מעלה',
  ready: 'מוכן לעיבוד',
  processing: 'בעיבוד',
  done: 'הושלם',
  failed: 'נכשל',
  rolling_back: 'בביטול',
  rolled_back: 'בוטל',
};

const HOW_LABEL = {
  name:          { text: 'לפי טלפון ושם',              tone: 'text-emerald-700' },
  phone:         { text: 'לפי טלפון',                   tone: 'text-emerald-700' },
  'phone-multi': { text: 'לפי טלפון (כמה לידים — נבחר החדש)', tone: 'text-amber-700' },
  none:          { text: 'לא נמצא ליד',                 tone: 'text-destructive' },
  nophone:       { text: 'אין טלפון',                   tone: 'text-destructive' },
  created:       { text: 'נוצרה משימה',                 tone: 'text-emerald-700' },
  updated:       { text: 'משימה עודכנה',                tone: 'text-emerald-700' },
  failed:        { text: 'נכשל',                        tone: 'text-destructive' },
  pending:       { text: 'ממתין',                       tone: 'text-muted-foreground' },
  rolled_back:   { text: 'בוטל',                        tone: 'text-muted-foreground' },
};
const STATUS_LABEL = Object.fromEntries(LEAD_STATUS_OPTIONS.map((o) => [o.value, o.label]));

// One row of the file beside the lead it lands on. Used twice: before the
// import (what WILL happen, computed here by the same rule the server uses)
// and after it (what DID happen, read back from staging).
function MatchTable({ title, rows, loading, summary }) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? rows : rows.slice(0, 100);
  return (
    <div className="rounded-lg border overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-muted/40 border-b">
        <span className="text-sm font-medium">{title}</span>
        {loading ? (
          <span className="text-xs text-muted-foreground flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" />מאתר לידים…</span>
        ) : summary ? (
          <span className="text-xs text-muted-foreground">
            <span className="text-emerald-700 font-medium">{summary.matched.toLocaleString('he-IL')} עם ליד</span>
            {' · '}
            <span className={summary.unmatched ? 'text-destructive font-medium' : ''}>{summary.unmatched.toLocaleString('he-IL')} ללא ליד</span>
          </span>
        ) : null}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead className="bg-muted/20 text-muted-foreground">
            <tr>
              <th className="px-2 py-1.5 text-start font-medium">#</th>
              <th className="px-2 py-1.5 text-start font-medium">בקובץ</th>
              <th className="px-2 py-1.5 text-start font-medium">ליד במערכת</th>
              <th className="px-2 py-1.5 text-start font-medium">איך שויך</th>
              <th className="px-2 py-1.5 text-start font-medium">נוצר</th>
              <th className="px-2 py-1.5 text-start font-medium">לביצוע</th>
              <th className="px-2 py-1.5 text-start font-medium">משימה</th>
              <th className="px-2 py-1.5 text-start font-medium">סטטוס ליד</th>
              <th className="px-2 py-1.5 text-start font-medium">נציג</th>
              <th className="px-2 py-1.5 text-start font-medium">תוכן</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const how = HOW_LABEL[r.how] || HOW_LABEL.pending;
              return (
                <tr key={r.i} className="border-t align-top">
                  <td className="px-2 py-1.5 text-muted-foreground tabular-nums">{r.i + 2}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    <div>{r.name || <span className="text-muted-foreground">—</span>}</div>
                    <div className="text-muted-foreground" dir="ltr">{r.phone}</div>
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    {r.lead ? (
                      <Link
                        to={createPageUrl('LeadDetails') + `?id=${r.lead.id}`}
                        target="_blank"
                        className="text-primary hover:underline inline-flex items-center gap-1"
                      >
                        {r.lead.full_name || r.lead.phone}
                        <ExternalLink className="h-3 w-3" />
                      </Link>
                    ) : <span className="text-muted-foreground">—</span>}
                    {r.lead?.phone && r.lead.phone !== r.phone ? (
                      <div className="text-muted-foreground" dir="ltr">{r.lead.phone}</div>
                    ) : null}
                  </td>
                  <td className={`px-2 py-1.5 whitespace-nowrap ${how.tone}`} title={r.error || ''}>{how.text}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap tabular-nums" dir="ltr">{r.created || '—'}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap tabular-nums" dir="ltr">{r.due || '—'}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">{r.taskStatus === 'completed' ? 'בוצעה' : 'פתוחה'}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">{r.status ? (STATUS_LABEL[r.status] || r.status) : <span className="text-muted-foreground">—</span>}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap" dir="ltr" title={r.moved ? `במקור: ${r.from}` : ''}>
                    {r.rep || '—'}
                    {r.moved ? <span className="text-amber-700 text-[10px] ms-1" dir="rtl">(הועבר)</span> : null}
                  </td>
                  <td className="px-2 py-1.5 max-w-[26rem] truncate" title={r.summary}>{r.summary}</td>
                </tr>
              );
            })}
            {!loading && rows.length === 0 ? (
              <tr><td colSpan={10} className="px-2 py-3 text-center text-muted-foreground">אין שורות</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {rows.length > 100 ? (
        <div className="px-3 py-2 border-t">
          <Button variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)}>
            {showAll ? 'הצג פחות' : `הצג את כל ${rows.length.toLocaleString('he-IL')} השורות`}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
