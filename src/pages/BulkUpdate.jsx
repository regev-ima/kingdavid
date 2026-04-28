import React, { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Users,
  CheckSquare,
  ShoppingCart,
  FileText,
  Crown,
  Headphones,
  RefreshCw,
  ArrowRight,
  ArrowLeft,
  Search,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Plus,
  Trash2,
  XCircle,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { BULK_UPDATE_ENTITIES, EMPTY_FIELD_VALUE } from '@/constants/bulkUpdateConfig';
import useEffectiveCurrentUser from '@/hooks/use-effective-current-user';
import { canAccessAdminOnly } from '@/lib/rbac';

const ICONS = { Users, CheckSquare, ShoppingCart, FileText, Crown, Headphones };

const delay = (ms) => new Promise(r => setTimeout(r, ms));

export default function BulkUpdate() {
  const { effectiveUser, isLoading: isLoadingUser } = useEffectiveCurrentUser();
  const [step, setStep] = useState(1);
  const [selectedEntity, setSelectedEntity] = useState(null);
  const [filters, setFilters] = useState({});
  const [matchCount, setMatchCount] = useState(null);
  const [counting, setCounting] = useState(false);
  const [updateRows, setUpdateRows] = useState([{ field: '', value: '' }]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [progress, setProgress] = useState({ successCount: 0, errorCount: 0, totalCount: 0, percent: 0 });
  const [result, setResult] = useState(null);
  const [reps, setReps] = useState([]);
  const [showAllFilters, setShowAllFilters] = useState(false);
  const cancelledRef = useRef(false);
  const taskNameRef = useRef(null);
  const isAdmin = canAccessAdminOnly(effectiveUser);

  useEffect(() => {
    if (!isAdmin) return;
    base44.entities.Representative.list().then(setReps).catch(() => {});
  }, [isAdmin]);

  const config = selectedEntity ? BULK_UPDATE_ENTITIES[selectedEntity] : null;

  if (isLoadingUser) {
    return <div className="text-center py-12">טוען...</div>;
  }

  if (!isAdmin) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">אין לך הרשאה לבצע עדכונים גורפים</p>
      </div>
    );
  }

  // Split filter fields into primary (first 6) and rest
  const primaryFilterCount = 6;
  const primaryFilters = config?.filterFields?.slice(0, primaryFilterCount) || [];
  const extraFilters = config?.filterFields?.slice(primaryFilterCount) || [];

  // A "phone" filter typed as 0537772829 used to compile to
  //   ILIKE '%0537772829%'
  // but most records in the DB are stored either as the international
  // form (972537772829) or with formatting (053-777-2829). The literal
  // ILIKE almost never matched and the count came back 0, so the
  // "המשך להגדרות עדכון" button (gated on a positive count) stayed
  // disabled.
  //
  // Strip non-digits from the user's input and search on the last 9
  // digits — that tail is identical across "0537772829", "972537772829"
  // and "+972-53-777-2829" (when the stored value is digit-only). For
  // values that legitimately have dashes the trigram index still
  // accelerates the substring match.
  const isPhoneFilterField = (field) => {
    const key = String(field?.key || '').toLowerCase();
    return key === 'phone' || key.endsWith('_phone');
  };
  const phoneSearchTail = (raw) => {
    const digits = String(raw || '').replace(/\D/g, '');
    if (!digits) return '';
    return digits.slice(-Math.min(9, digits.length));
  };

  const buildFilter = () => {
    const conditions = [];

    for (const field of config?.filterFields || []) {
      const val = filters[field.key];
      if (val === undefined || val === null || val === '') continue;

      if (field.type === 'date_range') {
        if (typeof val !== 'object') continue;
        const range = {};
        if (val.from) range['$gte'] = val.from;
        if (val.to) range['$lte'] = val.to;
        if (Object.keys(range).length > 0) {
          conditions.push({ [field.key]: range });
        }
      } else if (val === EMPTY_FIELD_VALUE) {
        // Search for records where this field is null or empty string
        conditions.push({
          '$or': [
            { [field.key]: null },
            { [field.key]: '' },
          ],
        });
      } else if (field.type === 'text' && isPhoneFilterField(field)) {
        // Phone-specific normalization (see comment above buildFilter).
        const tail = phoneSearchTail(val);
        if (!tail) continue;
        conditions.push({
          [field.key]: { '$regex': tail, '$options': 'i' },
        });
      } else if (field.type === 'text') {
        // Text fields use regex for partial match
        conditions.push({
          [field.key]: { '$regex': val, '$options': 'i' },
        });
      } else {
        // Select, rep, boolean - exact match
        conditions.push({ [field.key]: val });
      }
    }

    if (conditions.length === 0) return {};
    if (conditions.length === 1) return conditions[0];
    return { '$and': conditions };
  };

  const buildUpdates = () => {
    const updates = {};
    for (const row of updateRows) {
      if (row.field && row.value !== '') {
        updates[row.field] = row.value;
      }
    }
    return updates;
  };

  const activeFilterCount = Object.entries(filters).filter(([_, v]) => {
    if (v === undefined || v === null || v === '') return false;
    if (typeof v === 'object') return v.from || v.to;
    return true;
  }).length;

  const handleCount = async () => {
    setCounting(true);
    setMatchCount(null);
    try {
      const filter = buildFilter();
      // base44.functions.invoke returns the parsed body directly — there is
      // no `.data` wrapper. Reading `res.data.count` was throwing TypeError
      // on every count and dumping us into the catch with matchCount=-1, so
      // the page reported "error in count" no matter what filters were set.
      const res = await base44.functions.invoke('initBulkUpdate', {
        entityName: selectedEntity,
        filter,
        mode: 'count',
      });
      setMatchCount(res?.count ?? 0);
    } catch (err) {
      console.error('Count error:', err);
      setMatchCount(-1);
    } finally {
      setCounting(false);
    }
  };

  const handleExecute = async () => {
    setConfirmOpen(false);
    setStep(4);
    setProcessing(true);
    setCancelled(false);
    cancelledRef.current = false;
    setResult(null);
    setProgress({ successCount: 0, errorCount: 0, totalCount: matchCount || 0, percent: 0 });

    try {
      const initRes = await base44.functions.invoke('initBulkUpdate', {
        entityName: selectedEntity,
        filter: buildFilter(),
        updates: buildUpdates(),
        mode: 'execute',
      });

      // Same `.data` mistake as in handleCount: invoke returns the body
      // directly, so the destructure was reading from undefined.
      const { taskName, totalCount } = initRes || {};
      taskNameRef.current = taskName;
      setProgress(p => ({ ...p, totalCount }));

      let hasMore = true;
      while (hasMore && !cancelledRef.current) {
        const res = await base44.functions.invoke('processBulkUpdateBatch', { taskName });
        const d = res || {};

        if (d.cancelled) {
          setCancelled(true);
          break;
        }

        setProgress({
          successCount: d.successCount,
          errorCount: d.errorCount,
          totalCount: d.totalCount || totalCount,
          percent: d.progress || 0,
        });

        hasMore = d.hasMore;
        if (hasMore) await delay(500);
      }

      setResult({
        success: true,
        cancelled: cancelledRef.current,
      });
    } catch (err) {
      setResult({ success: false, error: err.message });
    } finally {
      setProcessing(false);
    }
  };

  const handleCancel = async () => {
    cancelledRef.current = true;
    setCancelled(true);
    if (taskNameRef.current) {
      try {
        const tasks = await base44.entities.SyncProgress.filter({ task_name: taskNameRef.current });
        if (tasks.length > 0) {
          await base44.entities.SyncProgress.update(tasks[0].id, { status: 'cancelled' });
        }
      } catch (e) {
        // best-effort cancel
      }
    }
  };

  const handleReset = () => {
    setStep(1);
    setSelectedEntity(null);
    setFilters({});
    setMatchCount(null);
    setUpdateRows([{ field: '', value: '' }]);
    setProgress({ successCount: 0, errorCount: 0, totalCount: 0, percent: 0 });
    setResult(null);
    setCancelled(false);
    cancelledRef.current = false;
    taskNameRef.current = null;
    setShowAllFilters(false);
  };

  const renderFilterFieldInput = (fieldConfig, value, onChange) => {
    if (fieldConfig.type === 'date_range') {
      const dateVal = (typeof value === 'object' && value !== null) ? value : {};
      return (
        <div className="flex gap-2">
          <Input
            type="date"
            placeholder="מתאריך"
            value={dateVal.from || ''}
            onChange={e => onChange({ ...dateVal, from: e.target.value })}
          />
          <Input
            type="date"
            placeholder="עד תאריך"
            value={dateVal.to || ''}
            onChange={e => onChange({ ...dateVal, to: e.target.value })}
          />
        </div>
      );
    }

    // For select/rep/text - wrap with "empty field" option
    if (fieldConfig.type === 'select') {
      return (
        <Select value={value || ''} onValueChange={onChange}>
          <SelectTrigger><SelectValue placeholder="בחר..." /></SelectTrigger>
          <SelectContent>
            <SelectItem value={EMPTY_FIELD_VALUE}>שדה ריק (ללא ערך)</SelectItem>
            {fieldConfig.options.map(o => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }

    if (fieldConfig.type === 'rep') {
      return (
        <Select value={value || ''} onValueChange={onChange}>
          <SelectTrigger><SelectValue placeholder="בחר נציג..." /></SelectTrigger>
          <SelectContent>
            <SelectItem value={EMPTY_FIELD_VALUE}>שדה ריק (ללא נציג)</SelectItem>
            {reps.map(r => (
              <SelectItem key={r.email} value={r.email}>{r.full_name} ({r.email})</SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }

    // Text field with empty option as checkbox
    return (
      <div className="space-y-1">
        {value === EMPTY_FIELD_VALUE ? (
          <div className="flex items-center gap-2 h-10 px-3 border rounded-md bg-muted/50">
            <span className="text-sm text-muted-foreground">מסנן: שדה ריק</span>
            <Button variant="ghost" size="sm" className="h-6 px-2 mr-auto" onClick={() => onChange('')}>
              <XCircle className="h-3 w-3" />
            </Button>
          </div>
        ) : (
          <div className="flex gap-2">
            <Input
              value={value || ''}
              onChange={e => onChange(e.target.value)}
              placeholder="הקלד לחיפוש..."
              className="flex-1"
            />
            <Button
              variant="outline"
              size="sm"
              className="text-xs whitespace-nowrap h-10"
              onClick={() => onChange(EMPTY_FIELD_VALUE)}
              title="חפש רשומות ששדה זה ריק"
            >
              שדה ריק
            </Button>
          </div>
        )}
      </div>
    );
  };

  const renderUpdateFieldInput = (fieldConfig, value, onChange) => {
    if (fieldConfig.type === 'select') {
      return (
        <Select value={value || ''} onValueChange={onChange}>
          <SelectTrigger><SelectValue placeholder="בחר..." /></SelectTrigger>
          <SelectContent>
            {fieldConfig.options.map(o => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }
    if (fieldConfig.type === 'rep') {
      return (
        <Select value={value || ''} onValueChange={onChange}>
          <SelectTrigger><SelectValue placeholder="בחר נציג..." /></SelectTrigger>
          <SelectContent>
            {reps.map(r => (
              <SelectItem key={r.email} value={r.email}>{r.full_name} ({r.email})</SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }
    return (
      <Input value={value || ''} onChange={e => onChange(e.target.value)} placeholder="הקלד ערך..." />
    );
  };

  // Step 1: Entity selection
  const renderStep1 = () => (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold mb-1">בחר ישות לעדכון</h2>
        <p className="text-sm text-muted-foreground">בחר את סוג הרשומות שברצונך לעדכן באופן המוני</p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {Object.entries(BULK_UPDATE_ENTITIES).map(([key, cfg]) => {
          const Icon = ICONS[cfg.icon] || RefreshCw;
          return (
            <Card
              key={key}
              className={`cursor-pointer transition-all hover:shadow-md hover:border-primary/50 ${selectedEntity === key ? 'border-primary ring-2 ring-primary/20' : ''}`}
              onClick={() => {
                setSelectedEntity(key);
                setFilters({});
                setMatchCount(null);
                setShowAllFilters(false);
              }}
            >
              <CardContent className="flex flex-col items-center gap-3 py-6">
                <Icon className="h-8 w-8 text-primary" />
                <span className="font-medium">{cfg.label}</span>
              </CardContent>
            </Card>
          );
        })}
      </div>
      <div className="flex justify-start">
        <Button onClick={() => setStep(2)} disabled={!selectedEntity}>
          <ArrowLeft className="h-4 w-4 me-2" />
          המשך לסינון
        </Button>
      </div>
    </div>
  );

  // Step 2: Filter + Count
  const renderStep2 = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold mb-1">סינון {config.label}</h2>
          <p className="text-sm text-muted-foreground">הגדר תנאי סינון לבחירת הרשומות לעדכון</p>
        </div>
        <Button variant="ghost" onClick={() => setStep(1)}>
          <ArrowRight className="h-4 w-4 me-2" />
          חזרה
        </Button>
      </div>

      {/* Primary filters - always visible */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {primaryFilters.map(field => (
          <div key={field.key} className="space-y-1.5">
            <div className="flex items-center gap-2">
              <Label>{field.label}</Label>
              {filters[field.key] && filters[field.key] !== '' && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 w-5 p-0 text-muted-foreground hover:text-red-500"
                  onClick={() => setFilters(f => { const n = {...f}; delete n[field.key]; return n; })}
                >
                  <XCircle className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
            {renderFilterFieldInput(field, filters[field.key], val =>
              setFilters(f => ({ ...f, [field.key]: val }))
            )}
          </div>
        ))}
      </div>

      {/* Extra filters - collapsible */}
      {extraFilters.length > 0 && (
        <div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowAllFilters(!showAllFilters)}
            className="w-full"
          >
            {showAllFilters ? <ChevronUp className="h-4 w-4 me-2" /> : <ChevronDown className="h-4 w-4 me-2" />}
            {showAllFilters ? 'הסתר שדות נוספים' : `הצג עוד ${extraFilters.length} שדות סינון`}
          </Button>
          {showAllFilters && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              {extraFilters.map(field => (
                <div key={field.key} className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Label>{field.label}</Label>
                    {filters[field.key] && filters[field.key] !== '' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-5 w-5 p-0 text-muted-foreground hover:text-red-500"
                        onClick={() => setFilters(f => { const n = {...f}; delete n[field.key]; return n; })}
                      >
                        <XCircle className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                  {renderFilterFieldInput(field, filters[field.key], val =>
                    setFilters(f => ({ ...f, [field.key]: val }))
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Active filters summary */}
      {activeFilterCount > 0 && (
        <div className="flex items-center gap-3 text-sm">
          <span className="text-muted-foreground">{activeFilterCount} פילטרים פעילים</span>
          <Button
            variant="ghost"
            size="sm"
            className="text-red-500 h-auto py-0"
            onClick={() => setFilters({})}
          >
            נקה הכל
          </Button>
        </div>
      )}

      <div className="flex items-center gap-4">
        <Button onClick={handleCount} disabled={counting}>
          {counting ? <Loader2 className="h-4 w-4 me-2 animate-spin" /> : <Search className="h-4 w-4 me-2" />}
          ספירת רשומות
        </Button>
        {matchCount !== null && matchCount >= 0 && (
          <span className="text-lg font-semibold text-primary">
            נמצאו {matchCount.toLocaleString()} רשומות
          </span>
        )}
        {matchCount === -1 && (
          <span className="text-red-600 text-sm">שגיאה בספירה</span>
        )}
      </div>

      <div className="flex justify-start">
        <Button onClick={() => setStep(3)} disabled={!matchCount || matchCount <= 0}>
          <ArrowLeft className="h-4 w-4 me-2" />
          המשך להגדרת עדכון
        </Button>
      </div>
    </div>
  );

  // Step 3: Define updates + confirm
  const renderStep3 = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold mb-1">הגדרת עדכון</h2>
          <p className="text-sm text-muted-foreground">בחר שדות וערכים חדשים עבור {matchCount?.toLocaleString()} רשומות</p>
        </div>
        <Button variant="ghost" onClick={() => setStep(2)}>
          <ArrowRight className="h-4 w-4 me-2" />
          חזרה
        </Button>
      </div>

      <div className="space-y-3">
        {updateRows.map((row, idx) => {
          const fieldConfig = config.updateFields.find(f => f.key === row.field);
          return (
            <div key={idx} className="flex gap-3 items-start">
              <div className="w-1/3">
                <Select
                  value={row.field}
                  onValueChange={val => {
                    const newRows = [...updateRows];
                    newRows[idx] = { field: val, value: '' };
                    setUpdateRows(newRows);
                  }}
                >
                  <SelectTrigger><SelectValue placeholder="בחר שדה..." /></SelectTrigger>
                  <SelectContent>
                    {config.updateFields
                      .filter(f => f.key === row.field || !updateRows.some(r => r.field === f.key))
                      .map(f => (
                        <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1">
                {fieldConfig
                  ? renderUpdateFieldInput(fieldConfig, row.value, val => {
                      const newRows = [...updateRows];
                      newRows[idx].value = val;
                      setUpdateRows(newRows);
                    })
                  : <Input disabled placeholder="בחר שדה תחילה" />
                }
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  if (updateRows.length <= 1) return;
                  setUpdateRows(updateRows.filter((_, i) => i !== idx));
                }}
                disabled={updateRows.length <= 1}
              >
                <Trash2 className="h-4 w-4 text-muted-foreground" />
              </Button>
            </div>
          );
        })}
      </div>

      {config?.updateFields?.filter(f => !updateRows.some(r => r.field === f.key)).length > 0 && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setUpdateRows([...updateRows, { field: '', value: '' }])}
        >
          <Plus className="h-4 w-4 me-1" />
          הוסף שדה
        </Button>
      )}

      <Button
        className="w-full"
        onClick={() => setConfirmOpen(true)}
        disabled={Object.keys(buildUpdates()).length === 0}
      >
        בצע עדכון המוני
      </Button>

      {/* Confirmation dialog */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>אישור עדכון המוני</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p><strong>ישות:</strong> {config?.label}</p>
            <p><strong>כמות רשומות:</strong> {matchCount?.toLocaleString()}</p>
            <div>
              <strong>פילטרים פעילים:</strong>
              <ul className="mt-1 list-disc list-inside">
                {Object.entries(filters).filter(([_, v]) => {
                  if (v === undefined || v === null || v === '') return false;
                  if (typeof v === 'object') return v.from || v.to;
                  return true;
                }).map(([key, val]) => {
                  const fc = config.filterFields.find(f => f.key === key);
                  let displayVal;
                  if (val === EMPTY_FIELD_VALUE) {
                    displayVal = 'שדה ריק';
                  } else if (typeof val === 'object') {
                    displayVal = `${val.from || '...'} עד ${val.to || '...'}`;
                  } else if (fc?.options) {
                    displayVal = fc.options.find(o => o.value === val)?.label || val;
                  } else if (fc?.type === 'rep') {
                    displayVal = reps.find(r => r.email === val)?.full_name || val;
                  } else {
                    displayVal = val;
                  }
                  return <li key={key}>{fc?.label || key}: {displayVal}</li>;
                })}
              </ul>
            </div>
            <div>
              <strong>שדות לעדכון:</strong>
              <ul className="mt-1 list-disc list-inside">
                {updateRows.filter(r => r.field && r.value !== '').map((r, i) => {
                  const fc = config.updateFields.find(f => f.key === r.field);
                  const displayVal = fc?.options
                    ? fc.options.find(o => o.value === r.value)?.label || r.value
                    : fc?.type === 'rep'
                    ? reps.find(rep => rep.email === r.value)?.full_name || r.value
                    : r.value;
                  return <li key={i}>{fc?.label}: {displayVal}</li>;
                })}
              </ul>
            </div>
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                פעולה זו תעדכן {matchCount?.toLocaleString()} רשומות. לא ניתן לבטל עדכון שכבר בוצע.
              </AlertDescription>
            </Alert>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>ביטול</Button>
            <Button onClick={handleExecute} className="bg-red-600 hover:bg-red-700">
              אישור וביצוע
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );

  // Step 4: Progress + Results
  const renderStep4 = () => {
    const { successCount, errorCount, totalCount, percent } = progress;
    const processed = successCount + errorCount;

    return (
      <div className="space-y-6">
        <h2 className="text-xl font-bold">
          {processing ? 'מעדכן רשומות...' : result?.success ? (result.cancelled ? 'העדכון בוטל' : 'העדכון הושלם') : 'שגיאה בעדכון'}
        </h2>

        {processing && (
          <div className="text-center space-y-4">
            <Loader2 className="h-12 w-12 animate-spin mx-auto text-primary" />
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                עודכנו {processed.toLocaleString()} מתוך {totalCount.toLocaleString()} רשומות
              </p>
              <div className="w-full bg-muted rounded-full h-2.5">
                <div
                  className="bg-primary h-2.5 rounded-full transition-all duration-300"
                  style={{ width: `${percent}%` }}
                />
              </div>
              <div className="flex justify-center gap-6 text-sm">
                <span className="text-green-600">הצלחות: {successCount.toLocaleString()}</span>
                {errorCount > 0 && <span className="text-red-600">שגיאות: {errorCount.toLocaleString()}</span>}
              </div>
              <Button variant="outline" onClick={handleCancel} className="mt-4">
                <XCircle className="h-4 w-4 me-2" />
                ביטול
              </Button>
            </div>
          </div>
        )}

        {!processing && result && (
          <div className="space-y-4">
            {result.success ? (
              <Alert className={result.cancelled ? 'border-amber-200 bg-amber-50' : 'border-green-200 bg-green-50'}>
                {result.cancelled
                  ? <AlertCircle className="h-4 w-4 text-amber-600" />
                  : <CheckCircle2 className="h-4 w-4 text-green-600" />
                }
                <AlertDescription>
                  {result.cancelled
                    ? `העדכון בוטל. עודכנו ${successCount.toLocaleString()} רשומות לפני הביטול.`
                    : `העדכון הושלם בהצלחה! עודכנו ${successCount.toLocaleString()} רשומות.`
                  }
                  {errorCount > 0 && ` ${errorCount.toLocaleString()} שגיאות.`}
                </AlertDescription>
              </Alert>
            ) : (
              <Alert className="border-red-200 bg-red-50">
                <AlertCircle className="h-4 w-4 text-red-600" />
                <AlertDescription>שגיאה: {result.error}</AlertDescription>
              </Alert>
            )}

            <div className="flex justify-center gap-6 text-sm font-medium">
              <span className="text-green-600">הצלחות: {successCount.toLocaleString()}</span>
              {errorCount > 0 && <span className="text-red-600">שגיאות: {errorCount.toLocaleString()}</span>}
              <span>סה"כ: {totalCount.toLocaleString()}</span>
            </div>

            <Button onClick={handleReset} className="w-full">
              <RefreshCw className="h-4 w-4 me-2" />
              עדכון חדש
            </Button>
          </div>
        )}
      </div>
    );
  };

  // Step indicator
  const steps = [
    { num: 1, label: 'בחירת ישות' },
    { num: 2, label: 'סינון' },
    { num: 3, label: 'הגדרת עדכון' },
    { num: 4, label: 'ביצוע' },
  ];

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3 mb-2">
        <RefreshCw className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">עדכון המוני</h1>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-6">
        {steps.map((s, i) => (
          <React.Fragment key={s.num}>
            {i > 0 && <div className={`flex-1 h-0.5 ${step >= s.num ? 'bg-primary' : 'bg-muted'}`} />}
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium ${
              step === s.num ? 'bg-primary text-white' : step > s.num ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
            }`}>
              <span>{s.num}</span>
              <span className="hidden sm:inline">{s.label}</span>
            </div>
          </React.Fragment>
        ))}
      </div>

      {step === 1 && renderStep1()}
      {step === 2 && renderStep2()}
      {step === 3 && renderStep3()}
      {step === 4 && renderStep4()}
    </div>
  );
}
