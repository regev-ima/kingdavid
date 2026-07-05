import React, { useMemo, useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Plus, Trash2, Loader2, Upload } from 'lucide-react';
import { compressImage } from '@/lib/imageCompression';

// Manages the bed configurator: the questions (groups), their choices (values),
// prices and images. Defined once for all beds; the quote/order wizard reads it.
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
    mutationFn: () => base44.entities.BedOptionGroup.create({ label: 'שאלה חדשה', sort_order: (groups.length ? Math.max(...groups.map((g) => g.sort_order || 0)) : 0) + 1, skippable: true, is_active: true }),
    onSuccess: () => { invalidate(); toast.success('שאלה נוספה'); }, onError: onErr('הוספה'),
  });
  const deleteGroup = useMutation({ mutationFn: (id) => base44.entities.BedOptionGroup.delete(id), onSuccess: () => { invalidate(); toast.success('נמחק'); }, onError: onErr('מחיקה') });
  const addValue = useMutation({
    mutationFn: (group) => base44.entities.BedOptionValue.create({ group_id: group.id, label: 'אפשרות', price: 0, sort_order: (valuesByGroup.get(group.id) || []).length + 1, is_active: true }),
    onSuccess: invalidate, onError: onErr('הוספה'),
  });
  const deleteValue = useMutation({ mutationFn: (id) => base44.entities.BedOptionValue.delete(id), onSuccess: invalidate, onError: onErr('מחיקה') });

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
              השאלות, האפשרויות, המחירים והתמונות שהנציג רואה כשמוסיף מיטה להצעה/הזמנה.
              מוגדר פעם אחת לכל המיטות; כל אפשרות שנבחרת הופכת לשורה בהצעה.
            </CardDescription>
          </div>
          <Button size="sm" className="shrink-0 gap-1" onClick={() => addGroup.mutate()} disabled={addGroup.isPending}>
            <Plus className="h-4 w-4" /> שאלה חדשה
          </Button>
        </CardHeader>
      </Card>

      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">אין עדיין שאלות. לחץ "שאלה חדשה" כדי להתחיל.</p>
      ) : groups.map((g) => {
        const gVals = valuesByGroup.get(g.id) || [];
        const dep = g.depends_on_group_key ? groupByKey.get(g.depends_on_group_key) : null;
        return (
          <Card key={g.id} className={g.is_active === false ? 'opacity-60' : ''}>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  defaultValue={g.label}
                  onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== g.label) updateGroup.mutate({ id: g.id, data: { label: v } }); }}
                  className="h-9 max-w-[16rem] font-semibold"
                  placeholder="שם השאלה"
                />
                {dep ? (
                  <span className="text-[11px] rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
                    מוצג רק אם "{dep.label}" = {g.depends_on_value_key}
                  </span>
                ) : null}
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
            </CardHeader>
            <CardContent className="space-y-2">
              {gVals.map((v) => (
                <ValueRow key={v.id} value={v} onUpdate={(data) => updateValue.mutate({ id: v.id, data })} onDelete={() => deleteValue.mutate(v.id)} />
              ))}
              <Button variant="outline" size="sm" className="gap-1" onClick={() => addValue.mutate(g)} disabled={addValue.isPending}>
                <Plus className="h-3.5 w-3.5" /> אפשרות
              </Button>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function ValueRow({ value, onUpdate, onDelete }) {
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

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
    <div className={`flex items-center gap-2 rounded-lg border border-border p-2 ${value.is_active === false ? 'opacity-60' : ''}`}>
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
      <div className="flex items-center gap-1 shrink-0">
        <span className="text-muted-foreground text-sm">₪</span>
        <Input
          type="number"
          defaultValue={value.price ?? 0}
          onBlur={(e) => { const n = Number(e.target.value) || 0; if (n !== Number(value.price)) onUpdate({ price: n }); }}
          className="h-9 w-24 tabular-nums"
        />
      </div>
      <Switch checked={value.is_active !== false} onCheckedChange={(v) => onUpdate({ is_active: v })} title="פעיל" />
      <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500 shrink-0" onClick={onDelete}>
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}
