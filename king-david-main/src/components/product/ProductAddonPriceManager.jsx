import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Edit, Trash2, Loader2 } from "lucide-react";

export default function ProductAddonPriceManager({ productId }) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingPrice, setEditingPrice] = useState(null);
  const [formData, setFormData] = useState({
    product_addon_id: '',
    product_size_id: '',
    price_delta: 0,
  });

  const queryClient = useQueryClient();

  const { data: sizes = [] } = useQuery({
    queryKey: ['productSizes', productId],
    queryFn: () => base44.entities.ProductSize.filter({ product_id: productId }),
    enabled: !!productId,
  });

  const { data: addons = [] } = useQuery({
    queryKey: ['extraCharges'],
    queryFn: () => base44.entities.ExtraCharge.filter({ is_active: true }),
  });

  const { data: addonPrices = [], isLoading } = useQuery({
    queryKey: ['productAddonPrices', productId],
    queryFn: async () => {
      if (!sizes.length) return [];
      const sizeIds = sizes.map(s => s.id);
      const allPrices = await base44.entities.ProductAddonPrice.list();
      return allPrices.filter(p => sizeIds.includes(p.product_size_id));
    },
    enabled: !!productId && sizes.length > 0,
  });

  const createPriceMutation = useMutation({
    mutationFn: (data) => base44.entities.ProductAddonPrice.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['productAddonPrices', productId]);
      setIsDialogOpen(false);
      resetForm();
    },
  });

  const updatePriceMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.ProductAddonPrice.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['productAddonPrices', productId]);
      setIsDialogOpen(false);
      resetForm();
    },
  });

  const deletePriceMutation = useMutation({
    mutationFn: (id) => base44.entities.ProductAddonPrice.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['productAddonPrices', productId]);
    },
  });

  const resetForm = () => {
    setEditingPrice(null);
    setFormData({
      product_addon_id: '',
      product_size_id: '',
      price_delta: 0,
    });
  };

  const handleEdit = (price) => {
    setEditingPrice(price);
    setFormData({
      product_addon_id: price.product_addon_id || '',
      product_size_id: price.product_size_id || '',
      price_delta: price.price_delta || 0,
    });
    setIsDialogOpen(true);
  };

  const handleSubmit = () => {
    if (editingPrice) {
      updatePriceMutation.mutate({ id: editingPrice.id, data: formData });
    } else {
      createPriceMutation.mutate(formData);
    }
  };

  const handleDelete = (id) => {
    if (confirm('האם אתה בטוח שברצונך למחוק מחיר זה?')) {
      deletePriceMutation.mutate(id);
    }
  };

  const getSizeName = (sizeId) => {
    const size = sizes.find(s => s.id === sizeId);
    return size?.size_label || 'לא ידוע';
  };

  const getAddonName = (addonId) => {
    const addon = addons.find(a => a.id === addonId);
    return addon?.name || 'לא ידוע';
  };

  if (sizes.length === 0) {
    return (
      <div className="text-center py-6 border rounded-lg bg-muted">
        <p className="text-muted-foreground">יש להגדיר מידות מוצר תחילה</p>
      </div>
    );
  }

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-right">מחירי תוספות לפי מידה</h3>
        <Dialog open={isDialogOpen} onOpenChange={(open) => { setIsDialogOpen(open); if (!open) resetForm(); }}>
          <DialogTrigger asChild>
            <Button size="sm" className="">
              <Plus className="h-4 w-4 mr-2" />
              הוסף מחיר
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingPrice ? 'עריכת מחיר' : 'מחיר חדש'}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>מידה *</Label>
                <Select
                  value={formData.product_size_id}
                  onValueChange={(v) => setFormData({ ...formData, product_size_id: v })}
                  disabled={!!editingPrice}
                >
                  <SelectTrigger><SelectValue placeholder="בחר מידה" /></SelectTrigger>
                  <SelectContent>
                    {sizes.map(size => (
                      <SelectItem key={size.id} value={size.id}>
                        {size.size_label} {size.dimensions && `(${size.dimensions})`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>תוספת *</Label>
                <Select
                  value={formData.product_addon_id}
                  onValueChange={(v) => setFormData({ ...formData, product_addon_id: v })}
                  disabled={!!editingPrice}
                >
                  <SelectTrigger><SelectValue placeholder="בחר תוספת" /></SelectTrigger>
                  <SelectContent>
                    {addons.map(addon => (
                      <SelectItem key={addon.id} value={addon.id}>
                        {addon.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>מחיר תוספת *</Label>
                <Input
                  type="number"
                  value={formData.price_delta}
                  onChange={(e) => setFormData({ ...formData, price_delta: parseFloat(e.target.value) || 0 })}
                />
              </div>
              <Button
                className="w-full "
                onClick={handleSubmit}
                disabled={createPriceMutation.isPending || updatePriceMutation.isPending}
              >
                {(createPriceMutation.isPending || updatePriceMutation.isPending) && (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                )}
                {editingPrice ? 'עדכן מחיר' : 'הוסף מחיר'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground text-center py-4">טוען...</p>
      ) : addonPrices.length === 0 ? (
        <p className="text-muted-foreground text-center py-4">לא הוגדרו מחירי תוספות עדיין</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-right">פעולות</TableHead>
              <TableHead className="text-right">מחיר</TableHead>
              <TableHead className="text-right">תוספת</TableHead>
              <TableHead className="text-right">מידה</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {addonPrices.map((price) => (
              <TableRow key={price.id}>
                <TableCell>
                  <div className="flex gap-2 justify-end">
                    <Button variant="ghost" size="sm" onClick={() => handleEdit(price)}>
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(price.id)}
                      className="text-red-500"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
                <TableCell className="font-semibold">₪{price.price_delta?.toLocaleString()}</TableCell>
                <TableCell className="text-foreground/80">{getAddonName(price.product_addon_id)}</TableCell>
                <TableCell className="font-medium">{getSizeName(price.product_size_id)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}