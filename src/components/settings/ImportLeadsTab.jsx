import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { Loader2, Upload, AlertCircle, CheckCircle2, FileSpreadsheet, RotateCcw, Download, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { readFileToRows, parseImportDate } from '@/utils/importFile';
import { matchStatus, auditStatuses } from '@/lib/leadStatusMatch';
import { isKaveretExport, kaveretMapping } from '@/lib/kaveretPreset';
import { extractEmail, auditRepEmails } from '@/lib/repEmailExtract';
import { toLocalIsraeliPhone } from '@/utils/phoneUtils';

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

// Rows per process_lead_import() call. 500 was chosen when the only evidence
// was a 71-row pilot; on the real 125,280-row file it never returned a single
// chunk. Each row costs ~4 statements plus an advisory lock (resolve the
// contact, look for a legacy lead to adopt, then update or insert), so 500 rows
// is a couple of thousand statements in one request — past the statement
// timeout PostgREST applies to `authenticated`. The call hung, the batch stayed
// `ready`, and nothing was ever committed.
//
// Measured against production: 100 rows is one comfortable call. More requests,
// but each one lands, and every landed chunk is committed work the run no
// longer has to repeat.
const PROCESS_CHUNK = 100;

// Canonical target fields. `aliases` drive header auto-detection — they are
// matched case-insensitively against the file's header row, so a Kaveret
// export maps itself on load and the user only fixes what it got wrong.
const FIELDS = [
  { key: 'external_id', label: 'מזהה כוורת', required: true,
    hint: 'המפתח לעדכון — שורה שחוזרת עם אותו מזהה תעדכן את הליד במקום ליצור חדש',
    aliases: ['id', 'lead id', 'leadid', 'מזהה', 'מזהה ליד', 'מספר ליד', 'קוד ליד', 'external id'] },
  { key: 'full_name', label: 'שם ושם משפחה', required: true,
    aliases: ['name', 'full name', 'fullname', 'שם', 'שם מלא', 'שם הליד', 'שם לקוח', 'שם ושם משפחה'] },
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
  // The lead form's two questions. Kaveret keeps them as custom fields headed
  // by the question text; the preset matches those by phrase (kaveretPreset).
  { key: 'facebook_requested_size', label: 'מה מידת המזרן?',
    aliases: ['facebook_requested_size', 'מה מידת המזרן שאתם מחפשים?', 'מה מידת המזרן שתרצו?', 'מידת המזרן', 'מידת מזרן'] },
  { key: 'facebook_try_at_home', label: 'איפה תרצו לנסות את המזרן?',
    aliases: ['facebook_try_at_home', 'איפה תרצו לנסות את המזרן?', 'איפה תרצו לנסות', 'איפה לנסות'] },
  // Marketing attribution. These are what the repeat-enquiry card shows per
  // enquiry ("this person came back three times — from which ad?"), so losing
  // them on import empties that screen for every historical lead.
  { key: 'facebook_ad_name', label: 'שם מודעה',
    aliases: ['ad name', 'שם מודעה', 'מודעה'] },
  { key: 'facebook_campaign_name', label: 'שם קמפיין',
    aliases: ['campaign name', 'שם קמפיין'] },
  { key: 'source_form',  label: 'טופס מקור',     aliases: ['form', 'source form', 'טופס', 'טופס מקור'] },
  { key: 'click_id',     label: 'Click ID',      aliases: ['gclid', 'click id', 'click_id'] },
  { key: 'utm_source',   label: 'UTM Source',    aliases: ['utm_source', 'utm source'] },
  { key: 'utm_medium',   label: 'UTM Medium',    aliases: ['utm_medium', 'utm medium'] },
  { key: 'utm_campaign', label: 'UTM Campaign',  aliases: ['utm_campaign', 'utm campaign', 'campaign', 'קמפיין'] },
  { key: 'utm_content',  label: 'UTM Content',   aliases: ['utm_content', 'utm content'] },
  { key: 'utm_term',     label: 'UTM Term',      aliases: ['utm_term', 'utm term'] },
  { key: 'landing_page', label: 'דף נחיתה',      aliases: ['landing_page', 'landing page', 'דף נחיתה', 'עמוד נחיתה'] },
];

const REQUIRED = FIELDS.filter((f) => f.required).map((f) => f.key);

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

// Accepts the English key, the Hebrew label, or a spelling variant of it.
// Anything genuinely unrecognised still becomes new_lead — but the audit panel
// lists those values first, so it is a decision rather than a silent default.
function normalizeStatus(raw) {
  return matchStatus(raw) || 'new_lead';
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
  const [isKaveret, setIsKaveret] = useState(false);
  const [showAllStatuses, setShowAllStatuses] = useState(false);
  const [showAllReps, setShowAllReps] = useState(false);
  // Chunk totals as they land, so a long merge shows it is moving. `result`
  // only appears at the end, which on a 125k file is an hour of nothing.
  const [running, setRunning] = useState({
    created_leads: 0, updated_leads: 0, adopted_leads: 0, failed_rows: 0,
    created_contacts: 0, matched_contacts: 0,
  });

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

  // Every distinct status in the file and what it resolves to. Computed over
  // ALL rows, not the 3-row preview: a status that appears once in row 40,000
  // is exactly the one a preview would miss.
  const statusAudit = useMemo(() => {
    const idx = mapping.status;
    if (idx === undefined || idx === null || !rows.length) return null;
    return auditStatuses(rows.map((r) => r[idx]));
  }, [mapping.status, rows]);

  // Loaded to tell "assigned to a real rep" from "assigned to an address nobody
  // here uses", and to populate the fallback picker below.
  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => base44.entities.User.list(),
    staleTime: 5 * 60 * 1000,
  });
  const { data: me = null } = useQuery({
    queryKey: ['auth-me'],
    queryFn: () => base44.auth.me().catch(() => null),
    staleTime: 5 * 60 * 1000,
  });

  const knownEmails = useMemo(
    () => new Set(users.map((u) => String(u?.email || '').toLowerCase()).filter(Boolean)),
    [users]
  );
  const admins = useMemo(
    () => users
      .filter((u) => u?.role === 'admin' && u?.email)
      .map((u) => String(u.email).toLowerCase())
      .sort(),
    [users]
  );

  // Where a lead goes when the file names a rep who is not a user here. The
  // Kaveret export still carries reps who left: 9 of the 15 addresses in the
  // last file, ~32k leads. Writing those addresses through means the leads
  // belong to nobody AND are excluded from the unassigned queue, because that
  // queue tests rep1 for empty — so they are invisible twice over.
  //
  // '' keeps the file's address as-is (the previous behaviour).
  const [unknownRepTo, setUnknownRepTo] = useState('');
  useEffect(() => {
    // Default to whoever is running the import, when they are an admin. Only
    // ever fills a blank choice, so a deliberate "leave as-is" is not undone.
    const mine = String(me?.email || '').toLowerCase();
    if (!unknownRepTo && mine && admins.includes(mine)) setUnknownRepTo(mine);
  }, [me, admins, unknownRepTo]);

  const repAudit = useMemo(() => {
    const idx = mapping.rep1;
    if (idx === undefined || idx === null || !rows.length) return null;
    return auditRepEmails(rows.map((r) => r[idx]), users.map((u) => u.email));
  }, [mapping.rep1, rows, users]);

  // Rows that the fallback will actually move, for the label on the picker.
  const reassignedRows = useMemo(
    () => (repAudit && unknownRepTo
      ? repAudit.unmatched.reduce((n, r) => n + r.count, 0)
      : 0),
    [repAudit, unknownRepTo]
  );

  const copyList = async (lines, what) => {
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      toast.success(`${what} הועתקו ללוח`);
    } catch {
      toast.error('ההעתקה נכשלה — הדפדפן חסם את הגישה ללוח');
    }
  };

  const reset = () => {
    setFileName(''); setHeaders([]); setRows([]); setMapping({});
    setPhase('idle'); setProgress({ current: 0, total: 0, label: '' });
    setResult(null); setParseError(''); setIsKaveret(false);
    setShowAllStatuses(false); setShowAllReps(false);
    setRunning({
      created_leads: 0, updated_leads: 0, adopted_leads: 0, failed_rows: 0,
      created_contacts: 0, matched_contacts: 0,
    });
    // unknownRepTo is deliberately kept: it is a choice about this operator's
    // workflow, not about this file, and re-picking it on every upload is how
    // an import ends up silently running with the wrong one.
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

      // A Kaveret export gets its known-good mapping outright. The generic
      // alias detection is still run underneath so any column the preset does
      // not name (a new custom field) is still picked up, with the preset
      // winning where both have an opinion.
      const kaveret = isKaveretExport(hdr);
      setIsKaveret(kaveret);
      setMapping(kaveret ? { ...autoDetect(hdr), ...kaveretMapping(hdr) } : autoDetect(hdr));
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
      } else if (field.key === 'phone') {
        // Kaveret writes "טלפון: 0547333975" — a label, not just a number.
        //
        // Matching never noticed: phone_normalized is a GENERATED column and
        // normalize_il_phone drops every non-digit, which is why the pilot
        // adopted 68 of 71 rows correctly. But `phone` itself is what the UI
        // renders and links, and `tel:טלפון: 0547333975` does not dial. The
        // stored value is normalized to local form so the number a rep clicks
        // is a number.
        out.phone = toLocalIsraeliPhone(raw) || raw;
      } else if (field.key === 'rep1') {
        // Parsed, not copied — the Kaveret rep cell is a rendered blob that
        // merely CONTAINS an address. A cell with no address at all assigns
        // nobody rather than writing junk into a field the app matches on.
        const email = extractEmail(raw);
        if (email) {
          // An address belonging to a rep who has left goes to the chosen
          // admin instead. A cell with NO address is untouched by this — it is
          // an unassigned lead, not a lead assigned to somebody who is gone,
          // and triage is the right destination for it.
          out.rep1 = unknownRepTo && !knownEmails.has(email) ? unknownRepTo : email;
        }
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

      // 3 — server-side merge, chunk by chunk. Every returned chunk is already
      //     committed, so an interrupted run resumes instead of restarting —
      //     but the LOOP lives here, in the tab. Closing it stops the import
      //     after the chunk in flight; re-running picks the rest up.
      setPhase('processing');
      setProgress({ current: 0, total: rows.length, label: 'מעבד ומקשר לאנשי קשר…' });

      const totals = {
        created_leads: 0, updated_leads: 0, adopted_leads: 0, failed_rows: 0,
        created_contacts: 0, matched_contacts: 0,
      };
      setRunning({ ...totals });
      let processed = 0;
      for (;;) {
        const { data, error } = await base44.supabase.rpc('process_lead_import', {
          p_batch_id: batchId,
          p_chunk: PROCESS_CHUNK,
        });
        if (error) throw error;
        for (const k of Object.keys(totals)) totals[k] += data[k] || 0;
        processed += data.processed_now || 0;
        setRunning({ ...totals });
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

          {isKaveret && (
            <Alert className="border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              <AlertDescription className="text-sm">
                <strong>זוהה ייצוא כוורת</strong> — המיפוי הוגדר אוטומטית, כולל מזהה השורה
                (<code dir="ltr">lead.id</code>), הטלפון עם הקידומת, שם המודעה ו-gclid.
                אפשר לרוץ ישירות. עבור על השדות למטה רק אם משהו נראה לא במקום.
              </AlertDescription>
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

              {/* ── status audit ──
                  Unrecognised statuses all collapse to new_lead. On a 115k-row
                  import that silently republishes every closed and dead lead as
                  fresh work, so the unmatched values are shown BEFORE the run,
                  with row counts, rather than being discovered afterwards. */}
              {statusAudit && (
                <div className="space-y-2">
                  <Label className="text-xs">סטטוסים שזוהו בקובץ</Label>
                  {statusAudit.unmatched.length > 0 ? (
                    <Alert variant="destructive">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription className="text-sm space-y-2">
                        <p>
                          <strong>{statusAudit.unmatched.length}</strong> סטטוסים לא זוהו
                          ויכנסו כ״ליד חדש״
                          {' '}({statusAudit.unmatched.reduce((n, r) => n + r.count, 0).toLocaleString('he-IL')} שורות):
                        </p>
                        {/* Every value, not a sample. Deciding whether an
                            unmatched status matters means reading it, and the
                            tail is exactly where the surprises live — the ones
                            hidden behind a "+13" are the ones nobody has seen
                            before. Collapsed by default so a file with 200
                            distinct statuses does not bury the page. */}
                        <div className="flex flex-wrap gap-1.5">
                          {(showAllStatuses ? statusAudit.unmatched : statusAudit.unmatched.slice(0, 12))
                            .map((r) => (
                              <Badge key={r.raw} variant="outline" className="font-normal">
                                {r.raw} · {r.count.toLocaleString('he-IL')}
                              </Badge>
                            ))}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {statusAudit.unmatched.length > 12 && (
                            <Button
                              type="button" size="sm" variant="outline" className="h-7 text-xs"
                              onClick={() => setShowAllStatuses((v) => !v)}
                            >
                              {showAllStatuses
                                ? 'הצג פחות'
                                : `הצג את כל ${statusAudit.unmatched.length} הסטטוסים`}
                            </Button>
                          )}
                          <Button
                            type="button" size="sm" variant="outline" className="h-7 gap-1.5 text-xs"
                            onClick={() => copyList(
                              statusAudit.unmatched.map((r) => `${r.raw}\t${r.count}`),
                              'הסטטוסים'
                            )}
                          >
                            <Copy className="h-3 w-3" /> העתק רשימה
                          </Button>
                        </div>
                        <p className="text-xs">
                          אם אלה סטטוסים אמיתיים שחשוב לשמר — בטל את מיפוי הסטטוס והרץ,
                          או בקש להוסיף אותם לטבלת ההתאמה.
                        </p>
                      </AlertDescription>
                    </Alert>
                  ) : (
                    <Alert className="border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      <AlertDescription className="text-sm">
                        כל {statusAudit.matched.length} הסטטוסים בקובץ זוהו והותאמו לסטטוסי המערכת.
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
              )}

              {/* ── rep audit ──
                  The rep column is a blob; only the address inside it is kept.
                  Shown per distinct address with a row count, and flagged when
                  no user carries it — a lead assigned to a non-user looks fine
                  in the import summary but belongs to nobody in the lead list,
                  and is excluded from the unassigned queue too. */}
              {repAudit && (
                <div className="space-y-2">
                  <Label className="text-xs">נציגים שחולצו מהקובץ</Label>
                  <div className="rounded-lg border border-border divide-y divide-border">
                    {(showAllReps ? repAudit.rows : repAudit.rows.slice(0, 15)).map((r) => (
                      <div key={r.email} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                        <span dir="ltr" className="font-mono text-xs truncate">{r.email}</span>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {r.count.toLocaleString('he-IL')} לידים
                          </span>
                          {r.isUser ? (
                            <Badge variant="outline" className="gap-1 text-emerald-700 border-emerald-300">
                              <CheckCircle2 className="h-3 w-3" /> נציג במערכת
                            </Badge>
                          ) : unknownRepTo ? (
                            <Badge variant="outline" className="text-amber-700 border-amber-300">
                              יעבור לאדמין
                            </Badge>
                          ) : (
                            <Badge variant="destructive">לא קיים כמשתמש</Badge>
                          )}
                        </div>
                      </div>
                    ))}
                    {repAudit.rows.length > 15 && (
                      <button
                        type="button"
                        onClick={() => setShowAllReps((v) => !v)}
                        className="w-full px-3 py-2 text-right text-xs text-muted-foreground hover:bg-muted/50"
                      >
                        {showAllReps ? 'הצג פחות' : `הצג את כל ${repAudit.rows.length} הנציגים`}
                      </button>
                    )}
                    {repAudit.rows.length === 0 && (
                      <div className="px-3 py-2 text-xs text-muted-foreground">
                        לא נמצאה אף כתובת מייל בעמודה שמופתה לנציג.
                      </div>
                    )}
                  </div>

                  {/* ── where leads of departed reps go ──
                      Writing a former rep's address through leaves the lead
                      owned by nobody and outside the unassigned queue at the
                      same time, because that queue tests rep1 for empty. So
                      the choice is explicit, and defaults to the admin running
                      the import rather than to the silently-broken option. */}
                  {repAudit.unmatched.length > 0 && (
                    <div className="rounded-lg border border-border p-3 space-y-2">
                      <Label className="text-xs">
                        נציגים שאינם משתמשים במערכת ({repAudit.unmatched.length} כתובות
                        {', '}
                        {repAudit.unmatched.reduce((n, r) => n + r.count, 0).toLocaleString('he-IL')} לידים)
                      </Label>
                      <Select
                        dir="rtl"
                        value={unknownRepTo || '__keep__'}
                        onValueChange={(v) => setUnknownRepTo(v === '__keep__' ? '' : v)}
                        disabled={busy}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__keep__">השאר את הכתובת מהקובץ</SelectItem>
                          {admins.map((email) => (
                            <SelectItem key={email} value={email}>שייך ל־{email}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {unknownRepTo ? (
                        <p className="text-xs text-muted-foreground">
                          {reassignedRows.toLocaleString('he-IL')} לידים של נציגים שעזבו ישויכו
                          ל־<span dir="ltr" className="font-mono">{unknownRepTo}</span>.
                          שורות שבהן עמודת הנציג ריקה לגמרי לא מושפעות — הן נכנסות ללא שיוך,
                          לטריאז׳.
                        </p>
                      ) : (
                        <p className="text-xs text-destructive">
                          הלידים האלה ישויכו לכתובות שאינן משתמשים — הם לא יופיעו אצל אף נציג,
                          וגם לא בתור ״לא משויכים״.
                        </p>
                      )}
                      {admins.length === 0 && (
                        <p className="text-xs text-destructive">
                          לא נמצא אף משתמש עם תפקיד אדמין לשייך אליו.
                        </p>
                      )}
                    </div>
                  )}
                  {repAudit.withoutEmail > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {repAudit.withoutEmail.toLocaleString('he-IL')} שורות עם ערך בעמודת הנציג
                      שלא הכיל כתובת מייל — ייכנסו ללא שיוך.
                    </p>
                  )}
                </div>
              )}

              {/* ── preview ── */}
              {missingRequired.length === 0 && rows.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-xs">תצוגה מקדימה (3 שורות ראשונות)</Label>
                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/50">
                        <tr>
                          {['מזהה', 'שם', 'טלפון', 'סטטוס', 'תאריך', 'נציג'].map((h) => (
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
                              <td className="px-3 py-2 whitespace-nowrap" dir="ltr">{p.rep1 || '—'}</td>
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

              {/* ── progress ──
                  The counter restarts at 0 when the upload hands over to the
                  merge, because they measure different work over the same
                  rows. Unlabelled, that reads as a crash: watching 6,000 of
                  125,280 drop back to 0 is indistinguishable from the import
                  starting over. So the step is named, and the merge shows what
                  it has actually landed — a slow run that is working now looks
                  different from a stalled one. */}
              {busy && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">
                      <span className="font-medium">
                        שלב {phase === 'uploading' ? '1' : '2'} מתוך 2
                      </span>
                      {' · '}{progress.label}
                    </span>
                    <span className="font-medium tabular-nums">
                      {progress.current.toLocaleString('he-IL')} / {progress.total.toLocaleString('he-IL')}
                    </span>
                  </div>
                  <Progress value={pct} />
                  {phase === 'processing' && (
                    <p className="text-xs text-muted-foreground">
                      {running.adopted_leads.toLocaleString('he-IL')} שויכו ללידים קיימים
                      {' · '}{running.created_leads.toLocaleString('he-IL')} חדשים
                      {' · '}{running.failed_rows.toLocaleString('he-IL')} נכשלו
                      {' — '}העיבוד רץ בצד השרת ומתחדש, אבל את הקצב מכתיב הדפדפן:
                      השאר את הלשונית פתוחה.
                    </p>
                  )}
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
                      {/* Adoption is the headline number on the first Kaveret run:
                          it is how many existing leads were claimed in place
                          instead of duplicated, with their orders and quotes
                          left attached. */}
                      <Badge variant="outline">שויכו ללידים קיימים: {(result.adopted_leads || 0).toLocaleString('he-IL')}</Badge>
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
