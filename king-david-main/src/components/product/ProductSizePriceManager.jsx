import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

export default function ProductSizePriceManager() {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [editingSize, setEditingSize] = useState(null);
  const [formData, setFormData] = useState({
    size_label: '',
    dimensions: '',
    base_price: 0,
    price_delta: 0,
    is_active: true,
    sort_order: 0,
  });

  const queryClient = useQueryClient();

  // Fetch products
  const { data: products = [] } = useQuery({
    queryKey: ['products'],
    queryFn: () => base44.entities.ProductCatalog.list(),
  });

  // Fetch sizes for selected product
  const { data: sizes = [], isLoading: sizesLoading } = useQuery({
    queryKey: ['productSizes', selectedProduct?.id],
    queryFn: () => base44.entities.ProductSize.filter({ product_id: selectedProduct?.id }),
    enabled: !!selectedProduct?.id,
  });

  const createSizeMutation = useMutation({
    mutationFn: (data) => base44.entities.ProductSize.create({ 
      ...data, 
      product_id: selectedProduct.id 
    }),
    onSuccess: () => {
      queryClient.invalidateQueries(['productSizes', selectedProduct?.id]);
      setIsDialogOpen(false);
      resetForm();
    },
  });

  const updateSizeMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.ProductSize.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['productSizes', selectedProduct?.id]);
      setIsDialogOpen(false);
      resetForm();
    },
  });

  const deleteSizeMutation = useMutation({
    mutationFn: (id) => base44.entities.ProductSize.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['productSizes', selectedProduct?.id]);
    },
  });

  const resetForm = () => {
    setEditingSize(null);
    setFormData({
      size_label: '',
      dimensions: '',
      base_price: 0,
      price_delta: 0,
      is_active: true,
      sort_order: 0,
    });
  };

  const handleEdit = (size) => {
    setEditingSize(size);
    setFormData({
      size_label: size.size_label || '',
      dimensions: size.dimensions || '',
      base_price: size.base_price || 0,
      price_delta: size.price_delta || 0,
      is_active: size.is_active !== false,
      sort_order: size.sort_order || 0,
    });
    setIsDialogOpen(true);
  };

  const handleSubmit = () => {
    if (!selectedProduct) return;
    
    if (editingSize) {
      updateSizeMutation.mutate({ id: editingSize.id, data: formData });
    } else {
      createSizeMutation.mutate(formData);
    }
  };

  const handleDelete = (id) => {
    if (confirm('האם אתה בטוח שברצונך למחוק מידה זו?')) {
      deleteSizeMutation.mutate(id);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>מידות מוצרים</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>בחר מוצר</Label>
            <Select value={selectedProduct?.id || ''} onValueChange={(productId) => {
              const product = products.find(p => p.id === productId);
              setSelectedProduct(product);
            }}>
              <SelectTrigger>
                <SelectValue placeholder="בחר מוצר..." />
              </SelectTrigger>
              <SelectContent>
                {products.map((product) => (
                  <SelectItem key={product.id} value={product.id}>
                    {product.name} ({product.sku})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedProduct && (
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">מידות עבור {selectedProduct.name}</h3>
              <Dialog open={isDialogOpen} onOpenChange={(open) => { 
                setIsDialogOpen(open); 
                if (!open) resetForm(); 
              }}>
                <DialogTrigger asChild>
                  <Button size="sm" className="bg-primary hover:bg-primary/90">
                    <Plus className="h-4 w-4 me-2" />
                    הוסף מידה
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>{editingSize ? 'עריכת מידה' : 'מידה חדשה'}</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>תווית מידה *</Label>
                      <Input
                        value={formData.size_label}
                        onChange={(e) => setFormData({ ...formData, size_label: e.target.value })}
                        placeholder="לדוגמה: יחיד, זוגי, קווין"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>מימדים</Label>
                      <Input
                        value={formData.dimensions}
                        onChange={(e) => setFormData({ ...formData, dimensions: e.target.value })}
                        placeholder='לדוגמה: 90x200 ס"מ'
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>מחיר בסיס *</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={formData.base_price}
                        onChange={(e) => setFormData({ ...formData, base_price: parseFloat(e.target.value) || 0 })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>תוספת/הפחתה למחיר</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={formData.price_delta}
                        onChange={(e) => setFormData({ ...formData, price_delta: parseFloat(e.target.value) || 0 })}
                        placeholder="0"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>סדר תצוגה</Label>
                      <Input
                        type="number"
                        value={formData.sort_order}
                        onChange={(e) => setFormData({ ...formData, sort_order: parseInt(e.target.value) || 0 })}
                      />
                    </div>
                    <Button
                      className="w-full bg-primary hover:bg-primary/90"
                      onClick={handleSubmit}
                      disabled={createSizeMutation.isPending || updateSizeMutation.isPending}
                    >
                      {(createSizeMutation.isPending || updateSizeMutation.isPending) && (
                        <Loader2 className="h-4 w-4 me-2 animate-spin" />
                      )}
                      {editingSize ? 'עדכן מידה' : 'הוסף מידה'}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          )}

          {selectedProduct && (
            <>
              {sizesLoading ? (
                <p className="text-muted-foreground text-center py-4">טוען...</p>
              ) : sizes.length === 0 ? (
                <p className="text-muted-foreground text-center py-4">לא הוגדרו מידות עדיין</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-right">מידה</TableHead>
                      <TableHead className="text-right">מימדים</TableHead>
                      <TableHead className="text-right">מחיר בסיס</TableHead>
                      <TableHead className="text-right">תוספת</TableHead>
                      <TableHead className="text-right">סטטוס</TableHead>
                      <TableHead className="text-right">פעולות</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sizes.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)).map((size) => (
                      <TableRow key={size.id}>
                        <TableCell className="font-medium">{size.size_label}</TableCell>
                        <TableCell className="text-muted-foreground">{size.dimensions || '-'}</TableCell>
                        <TableCell className="font-semibold">₪{size.base_price?.toLocaleString()}</TableCell>
                        <TableCell className={size.price_delta > 0 ? 'text-green-600' : size.price_delta < 0 ? 'text-red-600' : ''}>
                          {size.price_delta > 0 ? '+' : ''}{size.price_delta}
                        </TableCell>
                        <TableCell>
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                            size.is_active !== false ? 'bg-emerald-100 text-emerald-700' : 'bg-muted text-foreground/80'
                          }`}>
                            {size.is_active !== false ? 'פעיל' : 'לא פעיל'}
                          </span>
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            <Button variant="ghost" size="sm" onClick={() => handleEdit(size)}>
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDelete(size.id)}
                              className="text-red-500"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}