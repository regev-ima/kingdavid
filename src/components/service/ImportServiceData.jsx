import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, FileSpreadsheet, AlertCircle, CheckCircle2, Upload } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { nextTicketNumber } from '@/constants/serviceOptions';
import { readFileToRows, parseImportDate } from '@/utils/importFile';

// Import historical SERVICE TICKETS from a CSV/Excel file. (Order import lives
// in Settings.) A ticket can be linked to an existing order by order number.
const FIELDS = [
  { key: 'ticket_number', label: 'מספר פנייה' },
  { key: 'order_number', label: 'מספר הזמנה לקישור' },
  { key: 'customer_name', label: 'שם לקוח *' },
  { key: 'customer_phone', label: 'טלפון' },
  { key: 'customer_email', label: 'אימייל' },
  { key: 'subject', label: 'נושא *' },
  { key: 'description', label: 'תיאור' },
  { key: 'request_type', label: 'סוג פנייה (general/trial_30d/warranty)' },
  { key: 'status', label: 'סטטוס (open/in_progress/resolved/closed)' },
  { key: 'product_name', label: 'מוצר' },
  { key: 'created_date', label: 'תאריך פתיחה (YYYY-MM-DD)' },
];

export default function ImportServiceData({ open, onOpenChange }) {
  const queryClient = useQueryClient();
  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]);
  const [fileName, setFileName] = useState('');
  const [mapping, setMapping] = useState({});
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [importResult, setImportResult] = useState(null);

  const reset = () => {
    setHeaders([]); setRows([]); setFileName(''); setMapping({});
    setProgress({ current: 0, total: 0 }); setImportResult(null);
  };

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setImportResult(null);
    try {
      const allRows = await readFileToRows(file);
      if (allRows.length === 0) { setHeaders([]); setRows([]); return; }
      setHeaders(allRows[0].map((h) => String(h)));
      setRows(allRows.slice(1));
    } catch (err) {
      console.error('[ImportServiceData] parse failed', err);
      setHeaders([]); setRows([]);
    }
  };

  const valueOf = (row, key) => {
    const idx = mapping[key];
    if (idx === undefined || idx === null || idx === '') return '';
    return String(row[idx] ?? '').trim();
  };

  const importMutation = useMutation({
    mutationFn: async () => {
      const results = { created: 0, linked: 0, failed: 0, errors: [] };
      setProgress({ current: 0, total: rows.length });
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        try {
          const name = valueOf(row, 'customer_name');
          const subject = valueOf(row, 'subject');
          if (!name && !subject) { results.failed++; continue; }
          // Link to an existing order by order number, if provided.
          let orderId = null;
          const orderNumber = valueOf(row, 'order_number');
          if (orderNumber) {
            const matches = await base44.entities.Order.filter({ order_number: orderNumber }, null, 1);
            if (matches?.[0]) { orderId = matches[0].id; results.linked++; }
          }
          const recent = await base44.entities.SupportTicket.list('-created_date', 1);
          await base44.entities.SupportTicket.create({
            ticket_number: valueOf(row, 'ticket_number') || nextTicketNumber(recent[0]?.ticket_number),
            order_id: orderId,
            customer_name: name,
            customer_phone: valueOf(row, 'customer_phone'),
            customer_email: valueOf(row, 'customer_email'),
            subject: subject || 'פנייה מיובאת',
            description: valueOf(row, 'description'),
            request_type: valueOf(row, 'request_type') || null,
            category: 'other',
            priority: 'medium',
            status: valueOf(row, 'status') || 'open',
            product_name: valueOf(row, 'product_name'),
            created_date: parseImportDate(valueOf(row, 'created_date')) || undefined,
            source: 'imported',
            opened_by_customer: false,
          });
          results.created++;
        } catch (err) {
          results.failed++;
          if (results.errors.length < 20) results.errors.push({ row: i + 2, error: err?.message || 'שגיאה' });
        }
        setProgress({ current: i + 1, total: rows.length });
      }
      return results;
    },
    onSuccess: (results) => {
      setImportResult(results);
      queryClient.invalidateQueries({ queryKey: ['service-tickets'] });
    },
  });

  const requiredMapped = ['customer_name', 'subject'].every((k) => {
    const v = mapping[k];
    return v !== undefined && v !== null && v !== '';
  });

  const handleClose = () => { reset(); onOpenChange(false); };

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(true) : handleClose())}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            ייבוא פניות שירות מ-CSV / Excel
          </DialogTitle>
        </DialogHeader>

        {!importResult ? (
          <div className="space-y-5">
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-sm">
                ייבוא פניות שירות מהעבר. ניתן לקשר כל פנייה להזמנה קיימת לפי מספר הזמנה (הזמנות מיובאות מאזור ההגדרות).
              </AlertDescription>
            </Alert>

            <div className="space-y-1.5">
              <Label>קובץ (CSV / Excel)</Label>
              <Input type="file" accept=".csv,.xlsx,.xls" onChange={handleFile} />
            </div>

            {headers.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-base font-semibold">מיפוי עמודות</Label>
                  <span className="text-xs text-muted-foreground">{fileName} · {rows.length} שורות</span>
                </div>
                <div className="grid gap-2.5 max-h-[360px] overflow-y-auto border rounded-lg p-4">
                  {FIELDS.map((field) => (
                    <div key={field.key} className="grid grid-cols-2 gap-4 items-center">
                      <Label className="text-sm">{field.label}</Label>
                      <Select
                        value={mapping[field.key]?.toString() ?? 'none'}
                        onValueChange={(v) => setMapping((m) => ({ ...m, [field.key]: v === 'none' ? null : parseInt(v) }))}
                      >
                        <SelectTrigger><SelectValue placeholder="בחר עמודה..." /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">ללא</SelectItem>
                          {headers.map((col, idx) => (
                            <SelectItem key={idx} value={idx.toString()}>{col || `עמודה ${idx}`}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {importMutation.isPending && progress.total > 0 && (
              <div className="space-y-2">
                <Progress value={(progress.current / progress.total) * 100} />
                <p className="text-sm text-center text-muted-foreground">מייבא {progress.current}/{progress.total}...</p>
              </div>
            )}

            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={handleClose}>ביטול</Button>
              <Button
                onClick={() => importMutation.mutate()}
                disabled={headers.length === 0 || rows.length === 0 || !requiredMapped || importMutation.isPending}
              >
                {importMutation.isPending ? <Loader2 className="h-4 w-4 me-2 animate-spin" /> : <Upload className="h-4 w-4 me-2" />}
                ייבא פניות
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <Alert className={importResult.created > 0 ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}>
              {importResult.created > 0 ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <AlertCircle className="h-4 w-4 text-red-600" />}
              <AlertDescription>
                <p className="font-medium">נוצרו {importResult.created} פניות{importResult.linked ? `, קושרו ${importResult.linked} להזמנות` : ''}{importResult.failed ? `, נכשלו ${importResult.failed}` : ''}.</p>
              </AlertDescription>
            </Alert>
            {importResult.errors?.length > 0 && (
              <div className="max-h-[240px] overflow-y-auto border rounded-lg p-3 bg-red-50 space-y-1">
                {importResult.errors.map((err, idx) => (
                  <div key={idx} className="text-sm text-red-700">שורה {err.row}: {err.error}</div>
                ))}
              </div>
            )}
            <div className="flex justify-end">
              <Button onClick={handleClose}>סגור</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
