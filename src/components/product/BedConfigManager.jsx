import React, { useMemo, useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Plus, Trash2, Loader2, Upload, ChevronUp, ChevronDown, Type } from 'lucide-react';
import { compressImage } from '@/lib/imageCompression';
import { genBedConfigToken, BED_NOTE_TYPES, BED_VAT_RATE, BED_FIELD_TYPES } from '@/lib/bedConfig';

const inclVat = (preVat) => Math.round((Number(preVat) || 0) * BED_VAT_RATE);

// Manages the bed configurator: the questions (groups) — their order and
// question-to-question dependencies — and the choices (values): price, image,
// and a sales note. Defined once for all beds; the quote wizard reads it.
export default function BedConfigManager() {
  const qc = useQueryClient();

  const { data: groups = [], isLoading: gLoading } = useQuery({
    queryKey: ['bed-option-groups'],
    queryFn: () => base44.entities.BedOptionGroup.list('sort_order'),
  });
  const { data: values = [], isLoading: vLoading } = useQuery({
    queryKey: ['bed-option-values'],
    queryFn: () => base44.entities.BedOptionValue.list('sort_order'),
  });
  // Existing product add-ons a value can link to for its price (single source of
  // truth). Same key as the quote flow → deduped.
  const { data: addons = [] } = useQuery({
    queryKey: ['product-addons'],
    queryFn: () => base44.entities.ProductAddon.filter({ is_active: true }),
  });

  const valuesByGroup = useMemo(() => {
    const m = new Map();
    for (const v of values) {
      if (!m.has(v.group_id)) m.set(v.group_id, []);
      m.get(v.group_id).push(v);
    }
    for (const arr of m.values()) arr.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    return m;
  }, [values]);
  const groupByKey = useMemo(() => new Map(groups.map((g) => [g.key, g])), [groups]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['bed-option-groups'] });
    qc.invalidateQueries({ queryKey: ['bed-option-values'] });
  };
  const onErr = (verb) => (e) => toast.error(`${verb} נכשל: ${e?.message || 'שגיאה'}`);

  const updateGroup = useMutation({ mutationFn: ({ id, data }) => base44.entities.BedOptionGroup.update(id, data), onSuccess: invalidate, onError: onErr('שמירה') });
  const updateValue = useMutation({ mutationFn: ({ id, data }) => base44.entities.BedOptionValue.update(id, data), onSuccess: invalidate, onError: onErr('שמירה') });
  const addGroup = useMutation({
    // key is required: the wizard's prefill + the question dependency both match
    // by key, so every group/value needs a stable, unique one. input_type is
    // 'choice' (image cards → priced lines) or 'text' (free-text fields).
    mutationFn: (inputType = 'choice') => base44.entities.BedOptionGroup.create({
      key: `g_${genBedConfigToken()}`,
      label: inputType === 'text' ? 'שאלת טקסט חדשה' : 'שאלה חדשה',
      sort_order: (groups.length ? Math.max(...groups.map((g) => g.sort_order || 0)) : 0) + 1,
      skippable: true, is_active: true, input_type: inputType,
    }),
    onSuccess: () => { invalidate(); toast.success('שאלה נוספה'); }, onError: onErr('הוספה'),
  });
  const deleteGroup = useMutation({ mutationFn: (id) => base44.entities.BedOptionGroup.delete(id), onSuccess: () => { invalidate(); toast.success('נמחק'); }, onError: onErr('מחיקה') });
  const addValue = useMutation({
    // A choice group's value is a priced option; a text group's value is a field.
    mutationFn: (group) => base44.entities.BedOptionValue.create(
      group.input_type === 'text'
        ? { key: `v_${genBedConfigToken()}`, group_id: group.id, label: 'שדה חדש', field_type: 'text', sort_order: (valuesByGroup.get(group.id) || []).length + 1, is_active: true }
        : { key: `v_${genBedConfigToken()}`, group_id: group.id, label: 'אפשרות', price: 0, sort_order: (valuesByGroup.get(group.id) || []).length + 1, is_active: true }
    ),
    onSuccess: invalidate, onError: onErr('הוספה'),
  });
  const deleteValue = useMutation({ mutationFn: (id) => base44.entities.BedOptionValue.delete(id), onSuccess: invalidate, onError: onErr('מחיקה') });

  // Reorder questions: normalise sort_order to array position and persist only
  // the rows that changed.
  const reorderGroups = useMutation({
    mutationFn: (updates) => Promise.all(updates.map((u) => base44.entities.BedOptionGroup.update(u.id, { sort_order: u.sort_order }))),
    onSuccess: invalidate, onError: onErr('סידור'),
  });
  const moveGroup = (idx, dir) => {
    const j = idx + dir;
    if (j < 0 || j >= groups.length) return;
    const arr = [...groups];
    [arr[idx], arr[j]] = [arr[j], arr[idx]];
    const updates = arr
      .map((g, i) => ({ id: g.id, sort_order: i + 1 }))
      .filter((u, i) => (arr[i].sort_order || 0) !== u.sort_order);
    if (updates.length) reorderGroups.mutate(updates);
  };

  if (gLoading || vLoading) {
    return <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-4" dir="rtl">
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3">
          <div>
            <CardTitle>תצורת מיטות</CardTitle>
            <CardDescription>
              השאלות, האפשרויות, המחירים והתמונות שהנציג רואה כשמוסיף מיטה להצעה.
              סדרו את השאלות, קשרו ביניהן (שאלה שמופיעה רק לפי תשובה קודמת), והוסיפו הערה לכל אפשרות.
              <br />
              <span className="font-medium">שאלת בחירה</span> — כרטיסי אפשרויות עם מחיר ותמונה; כל בחירה הופכת לשורה בהצעה (מחיר כולל מע״מ).
              <span className="font-medium"> שאלת טקסט</span> — שדות שהנציג ממלא (למשל קטלוג בד: שם קטלוג / מס׳ צבע / צבע / ספק); מוצגים בהצעה ובהזמנה, ללא מחיר.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            <Button size="sm" variant="outline" className="gap-1" onClick={() => addGroup.mutate('choice')} disabled={addGroup.isPending}>
              <Plus className="h-4 w-4" /> שאלת בחירה
            </Button>
            <Button size="sm" className="gap-1" onClick={() => addGroup.mutate('text')} disabled={addGroup.isPending}>
              <Type className="h-4 w-4" /> שאלת טקסט
            </Button>
          </div>
        </CardHeader>
      </Card>

      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">אין עדיין שאלות. לחץ "שאלה חדשה" כדי להתחיל.</p>
      ) : groups.map((g, idx) => {
        const gVals = valuesByGroup.get(g.id) || [];
        const isText = g.input_type === 'text';
        const depGroup = g.depends_on_group_key ? groupByKey.get(g.depends_on_group_key) : null;
        const depValues = depGroup ? (valuesByGroup.get(depGroup.id) || []) : [];
        return (
          <Card key={g.id} className={g.is_active === false ? 'opacity-60' : ''}>
            <CardHeader className="pb-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                {/* Reorder */}
                <div className="flex flex-col shrink-0">
                  <button type="button" onClick={() => moveGroup(idx, -1)} disabled={idx === 0} className="text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed" title="הזז למעלה">
                    <ChevronUp className="h-4 w-4" />
                  </button>
                  <button type="button" onClick={() => moveGroup(idx, 1)} disabled={idx === groups.length - 1} className="text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed" title="הזז למטה">
                    <ChevronDown className="h-4 w-4" />
                  </button>
                </div>
                <span className="text-xs text-muted-foreground shrink-0 w-5 text-center">{idx + 1}</span>
                <Input
                  defaultValue={g.label}
                  key={`label-${g.id}-${g.label}`}
                  onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== g.label) updateGroup.mutate({ id: g.id, data: { label: v } }); }}
                  className="h-9 max-w-[16rem] font-semibold"
                  placeholder="שם השאלה"
                />
                {/* Per-question type — editable: switch between an options
                    (choice) question and a free-text question at any time. */}
                <select
                  value={isText ? 'text' : 'choice'}
                  onChange={(e) => updateGroup.mutate({ id: g.id, data: { input_type: e.target.value } })}
                  className={`h-8 shrink-0 rounded-md border px-2 text-xs font-medium ${isText ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-slate-50 text-slate-600 border-slate-200'}`}
                  title="סוג השאלה"
                >
                  <option value="choice">אפשרויות (בחירה)</option>
                  <option value="text">טקסט חופשי</option>
                </select>
                <div className="flex items-center gap-3 ms-auto">
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                    ניתן לדלג
                    <Switch checked={g.skippable !== false} onCheckedChange={(v) => updateGroup.mutate({ id: g.id, data: { skippable: v } })} />
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                    פעיל
                    <Switch checked={g.is_active !== false} onCheckedChange={(v) => updateGroup.mutate({ id: g.id, data: { is_active: v } })} />
                  </label>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500" onClick={() => { if (confirm('למחוק את השאלה וכל האפשרויות שלה?')) deleteGroup.mutate(g.id); }}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* Question-to-question dependency */}
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground ps-9">
                <span>הצג שאלה זו:</span>
                <select
                  value={g.depends_on_group_key || ''}
                  onChange={(e) => { const k = e.target.value || null; updateGroup.mutate({ id: g.id, data: { depends_on_group_key: k, depends_on_value_key: null } }); }}
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                >
                  <option value="">תמיד</option>
                  {/* Only CHOICE questions have a single answer to depend on. */}
                  {groups.filter((x) => x.id !== g.id && x.input_type !== 'text').map((x) => (
                    <option key={x.id} value={x.key}>רק אם "{x.label}"</option>
                  ))}
                </select>
                {g.depends_on_group_key ? (
                  <>
                    <span>=</span>
                    <select
                      value={g.depends_on_value_key || ''}
                      onChange={(e) => updateGroup.mutate({ id: g.id, data: { depends_on_value_key: e.target.value || null } })}
                      className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    >
                      <option value="">בחר תשובה…</option>
                      {depValues.map((v) => (
                        <option key={v.id} value={v.key}>{v.label}</option>
                      ))}
                    </select>
                  </>
                ) : null}
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {gVals.map((v) => (
                isText
                  ? <FieldRow key={v.id} value={v} onUpdate={(data) => updateValue.mutate({ id: v.id, data })} onDelete={() => deleteValue.mutate(v.id)} />
                  : <ValueRow key={v.id} value={v} addons={addons} onUpdate={(data) => updateValue.mutate({ id: v.id, data })} onDelete={() => deleteValue.mutate(v.id)} />
              ))}
              <Button variant="outline" size="sm" className="gap-1" onClick={() => addValue.mutate(g)} disabled={addValue.isPending}>
                <Plus className="h-3.5 w-3.5" /> {isText ? 'שדה' : 'אפשרות'}
              </Button>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function ValueRow({ value, addons = [], onUpdate, onDelete }) {
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  const linkedAddon = value.addon_id ? addons.find((a) => a.id === value.addon_id) : null;
  // Add-on prices are stored pre-VAT; show the customer-facing (incl-VAT) figure.
  const addonInclVat = linkedAddon ? inclVat(linkedAddon.base_price ?? linkedAddon.price ?? 0) : null;

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const compressed = await compressImage(file);
      const { file_url } = await base44.integrations.Core.UploadFile({ file: compressed });
      onUpdate({ image_url: file_url });
    } catch {
      toast.error('העלאת התמונה נכשלה');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className={`rounded-lg border border-border p-2 space-y-2 ${value.is_active === false ? 'opacity-60' : ''}`}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="relative h-12 w-12 shrink-0 rounded-md border border-border overflow-hidden bg-muted flex items-center justify-center hover:border-primary transition-colors"
          title="העלה/החלף תמונה"
        >
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" />
            : value.image_url ? <img src={value.image_url} alt="" className="h-full w-full object-cover" />
            : <Upload className="h-4 w-4 text-muted-foreground" />}
        </button>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />

        <Input
          defaultValue={value.label}
          onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== value.label) onUpdate({ label: v }); }}
          className="h-9 flex-1 min-w-0"
          placeholder="תווית האפשרות"
        />

        {/* Price source: link an existing add-on (price comes from it) or type a flat price */}
        <select
          value={value.addon_id || ''}
          onChange={(e) => onUpdate({ addon_id: e.target.value || null })}
          className="h-9 w-40 shrink-0 rounded-md border border-input bg-background px-2 text-sm"
          title="מקור המחיר"
        >
          <option value="">מחיר ידני</option>
          {addons.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>

        {linkedAddon ? (
          <div className="flex flex-col items-end shrink-0 w-28" title="המחיר מגיע מהתוספת המקושרת (כולל מע״מ)">
            <span className="text-sm font-medium tabular-nums">₪{Number(addonInclVat).toLocaleString()}</span>
            <span className="text-[10px] text-muted-foreground">כולל מע״מ</span>
          </div>
        ) : (
          <div className="flex flex-col items-end shrink-0">
            <div className="flex items-center gap-1">
              <span className="text-muted-foreground text-sm">₪</span>
              <Input
                type="number"
                defaultValue={value.price ?? 0}
                onBlur={(e) => { const n = Number(e.target.value) || 0; if (n !== Number(value.price)) onUpdate({ price: n }); }}
                className="h-9 w-24 tabular-nums"
              />
            </div>
            <span className="text-[10px] text-muted-foreground pe-1">כולל מע״מ</span>
          </div>
        )}

        <Switch checked={value.is_active !== false} onCheckedChange={(v) => onUpdate({ is_active: v })} title="פעיל" />
        <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500 shrink-0" onClick={onDelete}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      {/* Sales note — helps the rep explain the difference between options */}
      <div className="flex items-center gap-2 ps-14">
        <select
          value={value.note_type || 'info'}
          onChange={(e) => onUpdate({ note_type: e.target.value })}
          className="h-8 w-28 shrink-0 rounded-md border border-input bg-background px-2 text-xs"
          title="סוג ההערה"
        >
          {BED_NOTE_TYPES.map((t) => (
            <option key={t.key} value={t.key}>{t.label}</option>
          ))}
        </select>
        <Input
          defaultValue={value.note || ''}
          key={`note-${value.id}`}
          onBlur={(e) => { const v = e.target.value.trim(); if (v !== (value.note || '')) onUpdate({ note: v || null }); }}
          className="h-8 flex-1 min-w-0 text-xs"
          placeholder="הערה לנציג (למשל: 'מסגרת שלמה חזקה יותר אך יקרה יותר')"
        />
      </div>
    </div>
  );
}

// A field inside a TEXT question: a label + a type (free text / dropdown). For a
// dropdown, the options are edited as a comma-separated list. No price/image/note
// (those are choice-question concepts).
function FieldRow({ value, onUpdate, onDelete }) {
  const isSelect = value.field_type === 'select';
  const optionsText = Array.isArray(value.options) ? value.options.join(', ') : '';
  return (
    <div className={`rounded-lg border border-border p-2 space-y-2 ${value.is_active === false ? 'opacity-60' : ''}`}>
      <div className="flex items-center gap-2">
        <Input
          defaultValue={value.label}
          key={`flabel-${value.id}`}
          onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== value.label) onUpdate({ label: v }); }}
          className="h-9 flex-1 min-w-0"
          placeholder="שם השדה (למשל: שם קטלוג)"
        />
        <select
          value={value.field_type || 'text'}
          onChange={(e) => onUpdate({ field_type: e.target.value })}
          className="h-9 w-36 shrink-0 rounded-md border border-input bg-background px-2 text-sm"
          title="סוג השדה"
        >
          {BED_FIELD_TYPES.map((t) => (
            <option key={t.key} value={t.key}>{t.label}</option>
          ))}
        </select>
        <Switch checked={value.is_active !== false} onCheckedChange={(v) => onUpdate({ is_active: v })} title="פעיל" />
        <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500 shrink-0" onClick={onDelete}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      {isSelect ? (
        <Input
          defaultValue={optionsText}
          key={`fopts-${value.id}`}
          onBlur={(e) => {
            const arr = e.target.value.split(',').map((s) => s.trim()).filter(Boolean);
            onUpdate({ options: arr.length ? arr : null });
          }}
          className="h-8 text-xs"
          placeholder="אפשרויות מופרדות בפסיק (למשל: פרחי, ארוטקס, בד U, אחר)"
        />
      ) : null}
    </div>
  );
}
