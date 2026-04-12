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
import { Loader2, FileSpreadsheet, AlertCircle, CheckCircle2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const customerFields = [
  { value: 'unique_id', label: 'מזהה ייחודי (לעדכון)' },
  { value: 'full_name', label: 'שם מלא *' },
  { value: 'phone', label: 'טלפון *' },
  { value: 'email', label: 'אימייל' },
  { value: 'address', label: 'כתובת' },
  { value: 'city', label: 'עיר' },
  { value: 'original_source', label: 'מקור (store/callcenter/digital/whatsapp/referral)' },
  { value: 'first_order_date', label: 'תאריך הזמנה ראשונה (YYYY-MM-DD)' },
  { value: 'total_orders', label: 'סה"כ הזמנות' },
  { value: 'total_revenue', label: 'סה"כ הכנסות' },
  { value: 'vip_status', label: 'VIP (true/false)' },
  { value: 'account_manager', label: 'נציג אחראי (מייל)' },
  { value: 'pending_rep_email', label: 'מייל נציג ממתין' },
  { value: 'notes', label: 'הערות' },
];

export default function ImportCustomers({ isOpen, onClose }) {
  const [spreadsheetId, setSpreadsheetId] = useState('');
  const [sheetName, setSheetName] = useState('');
  const [mapping, setMapping] = useState({});
  const [importResult, setImportResult] = useState(null);
  const [columns, setColumns] = useState([]);
  const [loadingColumns, setLoadingColumns] = useState(false);
  const queryClient = useQueryClient();

  const importMutation = useMutation({
    mutationFn: async ({ spreadsheetId, sheetName, mapping }) => {
      const response = await base44.functions.invoke('importCustomersFromSheets', {
        spreadsheetId,
        sheetName,
        mapping,
      });
      return response.data;
    },
    onSuccess: (data) => {
      setImportResult(data);
      queryClient.invalidateQueries(['customers']);
    },
  });

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

  const handleImport = () => {
    const filteredMapping = {};
    Object.entries(mapping).forEach(([field, columnIndex]) => {
      if (columnIndex !== '' && columnIndex !== null && columnIndex !== undefined) {
        filteredMapping[field] = parseInt(columnIndex);
      }
    });

    importMutation.mutate({
      spreadsheetId,
      sheetName: sheetName || undefined,
      mapping: filteredMapping,
    });
  };

  const handleClose = () => {
    setSpreadsheetId('');
    setSheetName('');
    setMapping({});
    setColumns([]);
    setImportResult(null);
    importMutation.reset();
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            ייבוא לקוחות מ-Google Sheets
          </DialogTitle>
        </DialogHeader>

        {!importResult ? (
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
                  {customerFields.map((field) => (
                    <div key={field.value} className="grid grid-cols-2 gap-4 items-center">
                      <Label className="text-sm">{field.label}</Label>
                      <Select
                        value={mapping[field.value]?.toString() ?? ''}
                        onValueChange={(value) => setMapping({
                          ...mapping,
                          [field.value]: value === 'none' ? null : parseInt(value)
                        })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="בחר עמודה..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">ללא</SelectItem>
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
                disabled={!spreadsheetId || !sheetName || columns.length === 0 || Object.keys(mapping).filter(k => mapping[k] !== null && mapping[k] !== undefined && mapping[k] !== '').length === 0 || importMutation.isPending}
                className="bg-green-600 hover:bg-green-700"
              >
                {importMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 me-2 animate-spin" />
                    מייבא...
                  </>
                ) : (
                  <>
                    <FileSpreadsheet className="h-4 w-4 me-2" />
                    ייבא לקוחות
                  </>
                )}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <Alert className={importResult.imported > 0 ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}>
              {importResult.imported > 0 ? (
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
                <Label className="text-red-600">שגיאות בשורות:</Label>
                <div className="max-h-[300px] overflow-y-auto border rounded-lg p-3 bg-red-50">
                  {importResult.errors.map((err, idx) => (
                    <div key={idx} className="text-sm text-red-700 mb-1">
                      שורה {err.row}: {err.error}
                    </div>
                  ))}
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