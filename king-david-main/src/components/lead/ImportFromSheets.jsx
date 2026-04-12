import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, FileSpreadsheet, AlertCircle, CheckCircle2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

const leadFields = [
  { value: 'unique_id', label: 'מזהה ייחודי (לעדכון)' },
  { value: 'full_name', label: 'שם מלא *' },
  { value: 'phone', label: 'טלפון *' },
  { value: 'email', label: 'אימייל' },
  { value: 'city', label: 'עיר' },
  { value: 'address', label: 'כתובת' },
  { value: 'source', label: 'מקור (store/callcenter/digital/whatsapp/referral)' },
  { value: 'utm_source', label: 'UTM Source' },
  { value: 'utm_medium', label: 'UTM Medium' },
  { value: 'utm_campaign', label: 'UTM Campaign' },
  { value: 'utm_content', label: 'UTM Content' },
  { value: 'utm_term', label: 'UTM Term' },
  { value: 'click_id', label: 'Click ID' },
  { value: 'landing_page', label: 'דף נחיתה' },
  { value: 'rep1', label: 'נציג ראשי (מייל)' },
  { value: 'rep2', label: 'נציג משני (מייל)' },
  { value: 'pending_rep_email', label: 'מייל נציג ממתין' },
  { value: 'notes', label: 'הערות' },
  { value: 'preferred_product', label: 'מוצר מועדף' },
  { value: 'budget', label: 'תקציב' },
  { value: 'status', label: 'סטטוס (new_lead, hot_lead, followup_before_quote, וכו\')' },
];

export default function ImportFromSheets({ isOpen, onClose }) {
  const [spreadsheetId, setSpreadsheetId] = useState('');
  const [sheetName, setSheetName] = useState('');
  const [mapping, setMapping] = useState({});
  const [importResult, setImportResult] = useState(null);
  const [columns, setColumns] = useState([]);
  const [loadingColumns, setLoadingColumns] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, imported: 0, updated: 0, errors: [] });
  const queryClient = useQueryClient();

  const importBatch = async (startRow, batchSize = 50) => {
    const response = await base44.functions.invoke('importLeadsFromSheets', {
      spreadsheetId,
      sheetName,
      mapping: Object.fromEntries(
        Object.entries(mapping).filter(([_, val]) => val !== '' && val !== null && val !== undefined)
      ),
      startRow,
      batchSize,
    });
    return response.data;
  };

  const fetchColumns = async () => {
    if (!spreadsheetId || !sheetName) return;
    
    setLoadingColumns(true);
    try {
      const response = await base44.functions.invoke('fetchSheetsColumns', {
        spreadsheet_id: spreadsheetId,
        sheet_name: sheetName,
      });
      setColumns(response.data.columns || []);
    } catch (error) {
      console.error('Failed to fetch columns:', error);
      setColumns([]);
    } finally {
      setLoadingColumns(false);
    }
  };

  const handleImport = async () => {
    setImporting(true);
    setProgress({ current: 0, total: 0, imported: 0, updated: 0, errors: [] });

    try {
      let startRow = 2;
      let hasMore = true;
      let totalImported = 0;
      let totalUpdated = 0;
      let allErrors = [];

      while (hasMore) {
        const result = await importBatch(startRow, 50);
        
        totalImported += result.imported || 0;
        totalUpdated += result.updated || 0;
        if (result.errors) {
          allErrors = [...allErrors, ...result.errors];
        }

        setProgress({
          current: result.totalRows ? Math.min(startRow + result.processedRows - 2, result.totalRows) : startRow + result.processedRows - 2,
          total: result.totalRows || 0,
          imported: totalImported,
          updated: totalUpdated,
          errors: allErrors,
        });

        hasMore = result.hasMore;
        startRow = result.nextStartRow;

        // Small delay to avoid overwhelming the server
        if (hasMore) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      setImportResult({
        success: true,
        imported: totalImported,
        updated: totalUpdated,
        errors: allErrors,
        message: `הייבוא הושלם! נוצרו ${totalImported} לידים חדשים${totalUpdated > 0 ? `, עודכנו ${totalUpdated} לידים` : ''}${allErrors.length > 0 ? `, ${allErrors.length} שגיאות` : ''}`,
      });

      queryClient.invalidateQueries(['leads']);
    } catch (error) {
      setImportResult({
        success: false,
        message: `שגיאה בייבוא: ${error.message}`,
        errors: [{ error: error.message }],
      });
    } finally {
      setImporting(false);
    }
  };

  const handleClose = () => {
    if (importing) return; // Prevent closing during import
    setSpreadsheetId('');
    setSheetName('');
    setMapping({});
    setColumns([]);
    setImportResult(null);
    setProgress({ current: 0, total: 0, imported: 0, updated: 0, errors: [] });
    setImporting(false);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            ייבוא לידים מ-Google Sheets
          </DialogTitle>
        </DialogHeader>

        {importing ? (
          <div className="space-y-6">
            <div className="text-center space-y-4">
              <Loader2 className="h-12 w-12 animate-spin mx-auto text-primary" />
              <div className="space-y-2">
                <p className="text-lg font-medium">מייבא לידים...</p>
                {progress.total > 0 && (
                  <>
                    <p className="text-sm text-muted-foreground">
                      מעבד {progress.current} מתוך {progress.total} שורות
                    </p>
                    <div className="w-full bg-muted rounded-full h-2.5">
                      <div 
                        className="bg-primary h-2.5 rounded-full transition-all duration-300"
                        style={{ width: `${(progress.current / progress.total) * 100}%` }}
                      />
                    </div>
                  </>
                )}
                <div className="text-sm text-muted-foreground space-y-1">
                  <p>✅ נוצרו: {progress.imported} לידים</p>
                  <p>🔄 עודכנו: {progress.updated} לידים</p>
                  {progress.errors.length > 0 && (
                    <p className="text-red-600">❌ שגיאות: {progress.errors.length}</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : !importResult ? (
          <div className="space-y-6">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Spreadsheet ID</Label>
                <Input
                  placeholder="לדוגמה: 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms"
                  value={spreadsheetId}
                  onChange={(e) => setSpreadsheetId(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  ה-ID נמצא ב-URL של הגיליון: docs.google.com/spreadsheets/d/<strong>SPREADSHEET_ID</strong>/edit
                </p>
              </div>

              <div className="space-y-2">
                <Label>שם הגיליון</Label>
                <Input
                  placeholder="Sheet1"
                  value={sheetName}
                  onChange={(e) => setSheetName(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  שם הגיליון בגוגל שיטס (חובה לקריאת העמודות)
                </p>
              </div>

              <Button
                onClick={fetchColumns}
                disabled={!spreadsheetId || !sheetName || loadingColumns}
                className="w-full"
                variant="outline"
              >
                {loadingColumns ? (
                  <>
                    <Loader2 className="h-4 w-4 me-2 animate-spin" />
                    טוען עמודות...
                  </>
                ) : (
                  'טען עמודות מהגיליון'
                )}
              </Button>
            </div>

            {columns.length > 0 && (
              <div className="space-y-3">
                <Label className="text-base font-semibold">מיפוי עמודות</Label>
                <p className="text-sm text-muted-foreground">
                  בחר עבור כל שדה את העמודה המתאימה מהגיליון
                </p>
                
                <div className="grid gap-3 max-h-[400px] overflow-y-auto border rounded-lg p-4">
                  {leadFields.map((field) => (
                    <div key={field.value} className="grid grid-cols-2 gap-4 items-center">
                      <Label className="text-sm">{field.label}</Label>
                      <Select
                        value={mapping[field.value]?.toString() ?? ''}
                        onValueChange={(value) => setMapping({
                          ...mapping,
                          [field.value]: value === '' ? null : parseInt(value)
                        })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="בחר עמודה..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={null}>ללא</SelectItem>
                          {columns.map((col, idx) => (
                            <SelectItem key={idx} value={idx.toString()}>
                              {col} (עמודה {idx})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <strong>חשוב:</strong> השורה הראשונה בגיליון צריכה להכיל כותרות. הנתונים יתחילו מהשורה השנייה.
                שדות מסומנים ב-* הם חובה (שם מלא וטלפון).
              </AlertDescription>
            </Alert>

            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={handleClose}>
                ביטול
              </Button>
              <Button
                onClick={handleImport}
                disabled={!spreadsheetId || columns.length === 0 || importing}
                className="bg-green-600 hover:bg-green-700"
              >
                <FileSpreadsheet className="h-4 w-4 me-2" />
                ייבא לידים
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <Alert className={importResult.success && importResult.imported > 0 ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}>
              {importResult.success && importResult.imported > 0 ? (
                <CheckCircle2 className="h-4 w-4 text-green-600" />
              ) : (
                <AlertCircle className="h-4 w-4 text-red-600" />
              )}
              <AlertDescription>
                <p className="font-medium">{importResult.message}</p>
              </AlertDescription>
            </Alert>

            {importResult.errors && importResult.errors.length > 0 && (
              <div className="space-y-2">
                <Label className="text-red-600">שגיאות ({importResult.errors.length}):</Label>
                <div className="max-h-[300px] overflow-y-auto border rounded-lg p-3 bg-red-50">
                  {importResult.errors.slice(0, 50).map((err, idx) => (
                    <div key={idx} className="text-sm text-red-700 mb-1">
                      {err.row ? `שורה ${err.row}: ` : ''}{err.error}
                    </div>
                  ))}
                  {importResult.errors.length > 50 && (
                    <div className="text-sm text-red-600 mt-2 font-medium">
                      ועוד {importResult.errors.length - 50} שגיאות...
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="flex justify-end">
              <Button onClick={handleClose} className="bg-primary hover:bg-primary/90">
                סגור
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}