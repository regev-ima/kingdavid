import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Pencil, Trash2, DollarSign, X } from "lucide-react";

const VAT_RATE = 1.18;

const CATEGORY_OPTIONS = [
  { value: 'bed', label: 'מיטה' },
  { value: 'mattress', label: 'מזרון' },
  { value: 'topper', label: 'תוספת' },
  { value: 'accessory', label: 'נלווה' },
];

const formatPrice = (price) => price != null ? `₪${price.toLocaleString()}` : '-';
const withVat = (price) => price != null ? Math.round(price * VAT_RATE) : null;

export default function ProductAddonsManager({ productId }) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingAddon, setEditingAddon] = useState(null);
  const [addonForm, setAddonForm] = useState({
    name: '',
    description: '',
    base_price: '',
    size_prices: [],
    applicable_categories: [],
    is_active: true,
    sort_order: 0
  });

  const queryClient = useQueryClient();

  const { data: addons = [] } = useQuery({
    queryKey: ['product-addons'],
    queryFn: () => base44.entities.ProductAddon.list('sort_order')
  });

  const { data: addonPrices = [] } = useQuery({
    queryKey: ['product-addon-prices', productId],
    queryFn: () => base44.entities.ProductAddonPrice.filter({ product_id: productId }),
    enabled: !!productId
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.ProductAddon.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['product-addons']);
      setIsDialogOpen(false);
      resetForm();
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.ProductAddon.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['product-addons']);
      setIsDialogOpen(false);
      resetForm();
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.ProductAddon.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['product-addons']);
    }
  });

  const resetForm = () => {
    setAddonForm({
      name: '',
      description: '',
      base_price: '',
      size_prices: [],
      applicable_categories: [],
      is_active: true,
      sort_order: 0
    });
    setEditingAddon(null);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const data = {
      ...addonForm,
      base_price: Number(addonForm.base_price),
      sort_order: Number(addonForm.sort_order),
      size_prices: addonForm.size_prices.map(sp => ({
        width_cm: Number(sp.width_cm),
        length_cm: Number(sp.length_cm),
        price: Number(sp.price)
      })).filter(sp => sp.width_cm && sp.length_cm && sp.price)
    };

    if (editingAddon) {
      updateMutation.mutate({ id: editingAddon.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const addSizePrice = () => {
    setAddonForm(prev => ({
      ...prev,
      size_prices: [...prev.size_prices, { width_cm: '', length_cm: '', price: '' }]
    }));
  };

  const updateSizePrice = (index, field, value) => {
    setAddonForm(prev => ({
      ...prev,
      size_prices: prev.size_prices.map((sp, i) => i === index ? { ...sp, [field]: value } : sp)
    }));
  };

  const removeSizePrice = (index) => {
    setAddonForm(prev => ({
      ...prev,
      size_prices: prev.size_prices.filter((_, i) => i !== index)
    }));
  };

  const handleEdit = (addon) => {
    setEditingAddon(addon);
    setAddonForm({
      name: addon.name || '',
      description: addon.description || '',
      base_price: addon.base_price || '',
      size_prices: addon.size_prices || [],
      applicable_categories: addon.applicable_categories || [],
      is_active: addon.is_active !== false,
      sort_order: addon.sort_order || 0
    });
    setIsDialogOpen(true);
  };

  const getAddonPrice = (addonId) => {
    const priceOverride = addonPrices.find((p) => p.addon_id === addonId);
    return priceOverride?.price;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">תוספות זמינות</h3>
        <Button onClick={() => {resetForm();setIsDialogOpen(true);}} size="sm" className="bg-primary text-foreground px-3 text-xs font-medium rounded-md inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 shadow hover:bg-primary/90 h-8">
          <Plus className="h-4 w-4 me-1" />
          תוספת חדשה
        </Button>
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingAddon ? 'עריכת תוספת' : 'תוספת חדשה'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label>שם התוספת *</Label>
              <Input
                value={addonForm.name}
                onChange={(e) => setAddonForm({ ...addonForm, name: e.target.value })}
                placeholder="ארגז מצעים"
                required />

            </div>

            <div>
              <Label>תיאור</Label>
              <Textarea
                value={addonForm.description}
                onChange={(e) => setAddonForm({ ...addonForm, description: e.target.value })}
                rows={2} />

            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label>מחיר בסיס (לפני מע"מ) *</Label>
                <Input
                  type="number"
                  value={addonForm.base_price}
                  onChange={(e) => setAddonForm({ ...addonForm, base_price: e.target.value })}
                  required />
              </div>
              <div>
                <Label>כולל מע"מ</Label>
                <div className="h-10 flex items-center px-3 bg-muted rounded-md text-sm font-medium text-muted-foreground">
                  {addonForm.base_price ? `₪${withVat(Number(addonForm.base_price))?.toLocaleString()}` : '-'}
                </div>
              </div>
              <div>
                <Label>סדר תצוגה</Label>
                <Input
                  type="number"
                  value={addonForm.sort_order}
                  onChange={(e) => setAddonForm({ ...addonForm, sort_order: e.target.value })} />
              </div>
            </div>

            {/* מחירים לפי מידה */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label>מחירים לפי מידה</Label>
                <Button type="button" variant="outline" size="sm" onClick={addSizePrice}>
                  <Plus className="h-3.5 w-3.5 me-1" /> הוסף מידה
                </Button>
              </div>
              {addonForm.size_prices.length === 0 ? (
                <p className="text-xs text-muted-foreground">לא הוגדרו מחירים לפי מידה. המחיר הבסיסי יחול על כל המידות.</p>
              ) : (
                <div className="space-y-2">
                  <div className="grid grid-cols-[1fr_1fr_1fr_1fr_auto] gap-2 text-xs font-medium text-muted-foreground">
                    <span>רוחב (ס"מ)</span>
                    <span>אורך (ס"מ)</span>
                    <span>מחיר (לפני מע"מ)</span>
                    <span>כולל מע"מ</span>
                    <span></span>
                  </div>
                  {addonForm.size_prices.map((sp, idx) => (
                    <div key={idx} className="grid grid-cols-[1fr_1fr_1fr_1fr_auto] gap-2 items-center">
                      <Input
                        type="number"
                        value={sp.width_cm}
                        onChange={(e) => updateSizePrice(idx, 'width_cm', e.target.value)}
                        placeholder="רוחב"
                        className="h-9"
                      />
                      <Input
                        type="number"
                        value={sp.length_cm}
                        onChange={(e) => updateSizePrice(idx, 'length_cm', e.target.value)}
                        placeholder="אורך"
                        className="h-9"
                      />
                      <Input
                        type="number"
                        value={sp.price}
                        onChange={(e) => updateSizePrice(idx, 'price', e.target.value)}
                        placeholder="מחיר"
                        className="h-9"
                      />
                      <div className="h-9 flex items-center px-2 bg-muted rounded-md text-xs text-muted-foreground">
                        {sp.price ? `₪${withVat(Number(sp.price))?.toLocaleString()}` : '-'}
                      </div>
                      <Button type="button" variant="ghost" size="icon" className="h-9 w-9" onClick={() => removeSizePrice(idx)}>
                        <X className="h-4 w-4 text-red-500" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <Label className="mb-2 block">קטגוריות רלוונטיות</Label>
              <div className="flex flex-wrap gap-4">
                {CATEGORY_OPTIONS.map((cat) => (
                  <label key={cat.value} className="flex items-center gap-2 cursor-pointer">
                    <Checkbox
                      checked={addonForm.applicable_categories.includes(cat.value)}
                      onCheckedChange={(checked) => {
                        setAddonForm((prev) => ({
                          ...prev,
                          applicable_categories: checked
                            ? [...prev.applicable_categories, cat.value]
                            : prev.applicable_categories.filter((c) => c !== cat.value)
                        }));
                      }}
                    />
                    <span className="text-sm">{cat.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={addonForm.is_active}
                onChange={(e) => setAddonForm({ ...addonForm, is_active: e.target.checked })}
                className="h-4 w-4" />

              <Label>פעיל</Label>
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                ביטול
              </Button>
              <Button type="submit">
                {editingAddon ? 'עדכן' : 'צור'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-right">שם</TableHead>
            <TableHead className="text-right">תיאור</TableHead>
            <TableHead className="text-right">קטגוריות</TableHead>
            <TableHead className="text-right">מחיר בסיס</TableHead>
            <TableHead className="text-right">כולל מע"מ</TableHead>
            <TableHead className="text-right">מחירים לפי מידה</TableHead>
            {productId && <TableHead className="text-right">מחיר למוצר זה</TableHead>}
            <TableHead className="text-right">סטטוס</TableHead>
            <TableHead className="text-right">פעולות</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {addons.map((addon) => {
            const customPrice = getAddonPrice(addon.id);
            return (
              <TableRow key={addon.id}>
                <TableCell className="font-medium">{addon.name}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{addon.description}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {(addon.applicable_categories || []).map((cat) => (
                      <Badge key={cat} variant="outline" className="text-xs">
                        {CATEGORY_OPTIONS.find((c) => c.value === cat)?.label || cat}
                      </Badge>
                    ))}
                    {(!addon.applicable_categories || addon.applicable_categories.length === 0) && (
                      <span className="text-muted-foreground/70 text-xs">כל הקטגוריות</span>
                    )}
                  </div>
                </TableCell>
                <TableCell>{formatPrice(addon.base_price)}</TableCell>
                <TableCell className="font-medium text-primary">{formatPrice(withVat(addon.base_price))}</TableCell>
                <TableCell>
                  {addon.size_prices?.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {addon.size_prices.map((sp, idx) => (
                        <span key={idx} className="text-xs bg-muted rounded px-1.5 py-0.5">
                          {sp.width_cm}×{sp.length_cm}: {formatPrice(sp.price)} ({formatPrice(withVat(sp.price))})
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-muted-foreground/70">-</span>
                  )}
                </TableCell>
                {productId &&
                <TableCell>
                    {customPrice !== undefined ?
                  <span className="font-semibold text-primary">₪{customPrice.toLocaleString()}</span> :

                  <span className="text-muted-foreground/70">-</span>
                  }
                  </TableCell>
                }
                <TableCell>
                  {addon.is_active ?
                  <Badge className="bg-green-100 text-green-800">פעיל</Badge> :

                  <Badge variant="secondary">לא פעיל</Badge>
                  }
                </TableCell>
                <TableCell>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="icon" onClick={() => handleEdit(addon)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        if (confirm('האם למחוק תוספת זו?')) {
                          deleteMutation.mutate(addon.id);
                        }
                      }}>

                      <Trash2 className="h-4 w-4 text-red-600" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>);

          })}
        </TableBody>
      </Table>
    </div>);

}