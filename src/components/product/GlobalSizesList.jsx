import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Plus, Edit, Trash2, AlertTriangle } from 'lucide-react';
import { getSizeDimensions, parseDimensionsText } from '@/lib/productSizes';

export default function GlobalSizesList() {
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingSize, setEditingSize] = useState(null);
  const [formData, setFormData] = useState({
    label: '',
    dimensions: '',
    width_cm: '',
    length_cm: '',
    size_surcharge: '',
    price: '',
    is_active: true,
    sort_order: ''
  });

  const { data: sizes = [], isLoading } = useQuery({
    queryKey: ['globalSizes'],
    queryFn: () => base44.entities.GlobalSize.list('sort_order')
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.GlobalSize.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['globalSizes']);
      setIsDialogOpen(false);
      resetForm();
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.GlobalSize.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['globalSizes']);
      setIsDialogOpen(false);
      resetForm();
    }
  });

  // Separate from updateMutation on purpose: that one closes the dialog and
  // clears the form on success, which is right for a dialog save and wrong for
  // a cell that was edited in place.
  const inlineUpdateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.GlobalSize.update(id, data),
    onSuccess: () => queryClient.invalidateQueries(['globalSizes']),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.GlobalSize.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['globalSizes']);
    }
  });

  const resetForm = () => {
    setFormData({
      label: '',
      dimensions: '',
      width_cm: '',
      length_cm: '',
      size_surcharge: '',
      price: '',
      is_active: true,
      sort_order: ''
    });
    setEditingSize(null);
  };

  const handleEdit = (size) => {
    setEditingSize(size);
    // Seed width/length from the stored columns, or from the text when the
    // row predates them — so opening an old size and saving it fills them in.
    const dims = getSizeDimensions(size);
    setFormData({
      label: size.label,
      dimensions: size.dimensions || '',
      width_cm: size.width_cm ?? dims?.width_cm ?? '',
      length_cm: size.length_cm ?? dims?.length_cm ?? '',
      size_surcharge: size.size_surcharge ?? '',
      price: size.price ?? '',
      is_active: size.is_active,
      sort_order: size.sort_order || 0
    });
    setIsDialogOpen(true);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    // The numeric fields come off the inputs as strings; an empty one means
    // "unknown", which the catalog stores as NULL rather than 0 — 0 would read
    // as a real (and impossible) measurement.
    const toNumberOrNull = (value) => {
      const n = Number(value);
      return value === '' || value === null || !Number.isFinite(n) ? null : n;
    };
    const data = {
      ...formData,
      width_cm: toNumberOrNull(formData.width_cm),
      length_cm: toNumberOrNull(formData.length_cm),
      // The three amount fields hold raw text while being typed (see the
      // inputs); an empty one means 0, not "unknown".
      size_surcharge: Number(formData.size_surcharge) || 0,
      price: Number(formData.price) || 0,
      sort_order: Number(formData.sort_order) || 0,
    };

    if (editingSize) {
      updateMutation.mutate({ id: editingSize.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  if (isLoading) return <div>טוען...</div>;

  return (
    <Card dir="rtl">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>מידות גלובליות</CardTitle>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={resetForm} className="">
              <Plus className="h-4 w-4 mr-2" />
              הוסף מידה
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingSize ? 'ערוך מידה' : 'מידה חדשה'}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label>שם המידה</Label>
                <Input
                  value={formData.label}
                  onChange={(e) => setFormData({ ...formData, label: e.target.value })}
                  placeholder="יחיד, זוגי, קווין..."
                  required
                />
              </div>
              <div>
                <Label>מימדים</Label>
                <Input
                  value={formData.dimensions}
                  // Typing "140/190" fills the two numeric fields below, so the
                  // catalog gets real numbers without anyone typing them twice.
                  onChange={(e) => {
                    const dimensions = e.target.value;
                    const parsed = parseDimensionsText(dimensions);
                    setFormData((prev) => ({
                      ...prev,
                      dimensions,
                      ...(parsed ? { width_cm: parsed.width_cm, length_cm: parsed.length_cm } : {}),
                    }));
                  }}
                  placeholder='90x200 ס"מ'
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>רוחב (ס"מ)</Label>
                  <Input
                    type="number"
                    value={formData.width_cm}
                    onChange={(e) => setFormData({ ...formData, width_cm: e.target.value })}
                    placeholder="140"
                  />
                </div>
                <div>
                  <Label>אורך (ס"מ)</Label>
                  <Input
                    type="number"
                    value={formData.length_cm}
                    onChange={(e) => setFormData({ ...formData, length_cm: e.target.value })}
                    placeholder="190"
                  />
                </div>
              </div>
              <div>
                <Label>תוספת למידה (₪)</Label>
                <Input
                  type="number"
                  value={formData.size_surcharge}
                  onChange={(e) => setFormData({ ...formData, size_surcharge: e.target.value })}
                  placeholder="0"
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  התוספת מעל מחיר הבסיס של המוצר. מידת הבסיס (140/190 בזוגי, 80/190 ביחיד) נשארת 0.
                </p>
              </div>
              <div>
                <Label>מחיר</Label>
                <Input
                  type="number"
                  value={formData.price}
                  onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                  placeholder='0'
                />
              </div>
              <div>
                <Label>סדר תצוגה</Label>
                <Input
                  type="number"
                  value={formData.sort_order}
                  onChange={(e) => setFormData({ ...formData, sort_order: e.target.value })}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label>פעיל</Label>
                <Switch
                  checked={formData.is_active}
                  onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                  ביטול
                </Button>
                <Button type="submit" className="">
                  {editingSize ? 'עדכן' : 'צור'}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-right">פעולות</TableHead>
              <TableHead className="text-right">סטטוס</TableHead>
              <TableHead className="text-right">סדר</TableHead>
              <TableHead className="text-right">מחיר</TableHead>
              <TableHead className="text-right">תוספת מעל הבסיס</TableHead>
              <TableHead className="text-right">מימדים</TableHead>
              <TableHead className="text-right">מידה</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sizes.map((size) => (
              <TableRow key={size.id}>
                <TableCell>
                  <div className="flex gap-2 justify-start">
                    <Button size="sm" variant="ghost" onClick={() => handleEdit(size)}>
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => deleteMutation.mutate(size.id)}>
                      <Trash2 className="h-4 w-4 text-red-600" />
                    </Button>
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <span className={`px-2 py-1 rounded text-xs ${size.is_active ? 'bg-green-100 text-green-800' : 'bg-muted text-muted-foreground'}`}>
                    {size.is_active ? 'פעיל' : 'לא פעיל'}
                  </span>
                </TableCell>
                <TableCell className="text-right">{size.sort_order}</TableCell>
                <TableCell className="text-right">₪{size.price?.toLocaleString() || '0'}</TableCell>
                <TableCell className="text-right">
                  {/* Edited in place: this column is the price table from the
                      showroom card, and opening a dialog to change one number in
                      it is the slow way to do the one thing this screen is for.
                      Saved on blur — a half-typed "4" isn't an amount. */}
                  <div className="flex items-center gap-1 justify-end">
                    <span className="text-muted-foreground text-xs">+₪</span>
                    <Input
                      type="number"
                      dir="ltr"
                      className="h-8 w-24 text-sm text-start"
                      defaultValue={size.size_surcharge ?? 0}
                      // Re-key on the saved value so a failed save or an edit
                      // from elsewhere doesn't leave a stale number on screen.
                      key={`surcharge-${size.id}-${size.size_surcharge ?? 0}`}
                      onBlur={(e) => {
                        const next = Number(e.target.value);
                        const current = Number(size.size_surcharge ?? 0);
                        if (!Number.isFinite(next) || next === current) return;
                        inlineUpdateMutation.mutate({ id: size.id, data: { size_surcharge: next } });
                      }}
                    />
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  {(() => {
                    const dims = getSizeDimensions(size);
                    if (!dims) {
                      // Without numbers this size can't build a variation or a
                      // SKU, so say so here instead of letting it quietly go
                      // missing from the product screen.
                      return (
                        <span className="inline-flex items-center gap-1 text-xs text-amber-700" title="יש למלא רוחב ואורך כדי שהמידה תהיה זמינה בהקמת מוצר">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          {size.dimensions || 'חסרות מידות'}
                        </span>
                      );
                    }
                    return <span dir="ltr">{dims.width_cm}/{dims.length_cm}</span>;
                  })()}
                </TableCell>
                <TableCell className="font-medium text-right">{size.label}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}