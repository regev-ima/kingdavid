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
import { IMPORTED_ORDER_TAG } from '@/constants/serviceOptions';
import { readFileToRows, parseImportDate } from '@/utils/importFile';

// Import historical ORDERS from a CSV/Excel file. Lives in Settings (admin
// data tools). Imported orders are flagged is_imported + tagged
// "הזמנה מיובאת" so service tickets can later be linked to them by order number.
const FIELDS = [
  { key: 'order_number', label: 'מספר הזמנה *' },
  { key: 'customer_name', label: 'שם לקוח *' },
  { key: 'customer_phone', label: 'טלפון' },
  { key: 'customer_email', label: 'אימייל' },
  { key: 'total', label: 'סכום' },
  { key: 'order_date', label: 'תאריך הזמנה (YYYY-MM-DD)' },
  { key: 'product', label: 'מוצר / פריטים' },
  { key: 'notes_sales', label: 'הערות' },
];

export default function ImportOrders({ open, onOpenChange }) {
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
      console.error('[ImportOrders] parse failed', err);
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
      const batchId = `import_${Date.now()}`;
      const results = { created: 0, failed: 0, errors: [] };
      setProgress({ current: 0, total: rows.length });
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        try {
          const orderNumber = valueOf(row, 'order_number');
          const name = valueOf(row, 'customer_name');
          if (!orderNumber && !name) { results.failed++; continue; }
          const total = Number(String(valueOf(row, 'total')).replace(/[^\d.]/g, '')) || 0;
          await base44.entities.Order.create({
            order_number: orderNumber || `IMP-${batchId}-${i}`,
            customer_name: name,
            customer_phone: valueOf(row, 'customer_phone'),
            customer_email: valueOf(row, 'customer_email'),
            total,
            subtotal: total,
            items: [],
            created_date: parseImportDate(valueOf(row, 'order_date')) || undefined,
            notes_sales: [valueOf(row, 'product'), valueOf(row, 'notes_sales')].filter(Boolean).join(' — '),
            is_imported: true,
            import_source: 'csv',
            import_batch_id: batchId,
            tags: [IMPORTED_ORDER_TAG],
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
      queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
  });

  const requiredMapped = ['order_number', 'customer_name'].every((k) => {
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
            ייבוא הזמנות מ-CSV / Excel
          </DialogTitle>
        </DialogHeader>

        {!importResult ? (
          <div className="space-y-5">
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-sm">
                ההזמנות יסומנו אוטומטית בתג <strong>״{IMPORTED_ORDER_TAG}״</strong>, וניתן יהיה לקשר אליהן פניות שירות לפי מספר ההזמנה.
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
                ייבא הזמנות
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <Alert className={importResult.created > 0 ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}>
              {importResult.created > 0 ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <AlertCircle className="h-4 w-4 text-red-600" />}
              <AlertDescription>
                <p className="font-medium">נוצרו {importResult.created} הזמנות{importResult.failed ? `, נכשלו ${importResult.failed}` : ''}.</p>
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
