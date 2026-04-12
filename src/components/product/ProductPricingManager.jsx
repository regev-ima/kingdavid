import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

export default function ProductPricingManager() {
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [pricingTab, setPricingTab] = useState('sizes');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingPrice, setEditingPrice] = useState(null);
  const [formData, setFormData] = useState({
    global_size_id: '',
    price_delta: 0,
  });

  const queryClient = useQueryClient();

  // Fetch products
  const { data: products = [] } = useQuery({
    queryKey: ['products'],
    queryFn: () => base44.entities.ProductCatalog.list(),
  });

  // Fetch global sizes
  const { data: globalSizes = [] } = useQuery({
    queryKey: ['globalSizes'],
    queryFn: () => base44.entities.GlobalSize.list('sort_order'),
  });

  // Fetch product addons
  const { data: productAddons = [] } = useQuery({
    queryKey: ['productAddons'],
    queryFn: () => base44.entities.ProductAddon.filter({ is_active: true }),
  });

  // Fetch size pricing for selected product
  const { data: sizePrices = [], isLoading: loadingSizePrices } = useQuery({
    queryKey: ['productSizePrices', selectedProduct?.id],
    queryFn: () => base44.entities.ProductSizePrice.filter({ product_id: selectedProduct?.id }),
    enabled: !!selectedProduct?.id && pricingTab === 'sizes',
  });

  // Fetch addon pricing for selected product
  const { data: addonPrices = [], isLoading: loadingAddonPrices } = useQuery({
    queryKey: ['productAddonPrices', selectedProduct?.id],
    queryFn: () => base44.entities.ProductAddonPrice.filter({ product_id: selectedProduct?.id }),
    enabled: !!selectedProduct?.id && pricingTab === 'addons',
  });

  const createSizePriceMutation = useMutation({
    mutationFn: (data) => base44.entities.ProductSizePrice.create({ 
      ...data, 
      product_id: selectedProduct.id 
    }),
    onSuccess: () => {
      queryClient.invalidateQueries(['productSizePrices', selectedProduct?.id]);
      setIsDialogOpen(false);
      resetForm();
    },
  });

  const updateSizePriceMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.ProductSizePrice.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['productSizePrices', selectedProduct?.id]);
      setIsDialogOpen(false);
      resetForm();
    },
  });

  const deleteSizePriceMutation = useMutation({
    mutationFn: (id) => base44.entities.ProductSizePrice.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['productSizePrices', selectedProduct?.id]);
    },
  });

  const resetForm = () => {
    setEditingPrice(null);
    setFormData({ global_size_id: '', price_delta: 0 });
  };

  const handleEdit = (price) => {
    setEditingPrice(price);
    setFormData({
      global_size_id: price.global_size_id,
      price_delta: price.price_delta || 0,
    });
    setIsDialogOpen(true);
  };

  const handleSubmit = () => {
    if (!selectedProduct || !formData.global_size_id) return;
    
    if (editingPrice) {
      updateSizePriceMutation.mutate({ id: editingPrice.id, data: formData });
    } else {
      createSizePriceMutation.mutate(formData);
    }
  };

  const handleDelete = (id) => {
    if (confirm('האם אתה בטוח?')) {
      deleteSizePriceMutation.mutate(id);
    }
  };

  const getSizeName = (sizeId) => {
    return globalSizes.find(s => s.id === sizeId)?.label || sizeId;
  };

  const getAddonName = (addonId) => {
    return productAddons.find(a => a.id === addonId)?.name || addonId;
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>תמחור מוצרים</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>בחר מוצר</Label>
            <Select value={selectedProduct?.id || ''} onValueChange={(productId) => {
              const product = products.find(p => p.id === productId);
              setSelectedProduct(product);
              setPricingTab('sizes');
            }}>
              <SelectTrigger>
                <SelectValue placeholder="בחר מוצר..." />
              </SelectTrigger>
              <SelectContent>
                {products.map((product) => (
                  <SelectItem key={product.id} value={product.id}>
                    {product.name} ({product.sku}) - מחיר בסיס: ₪{product.base_price?.toLocaleString()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedProduct && (
            <Tabs value={pricingTab} onValueChange={setPricingTab}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="sizes">תוספות מידה</TabsTrigger>
                <TabsTrigger value="addons">תוספות מוצר</TabsTrigger>
              </TabsList>

              <TabsContent value="sizes" className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">
                    מחיר בסיס: <span className="font-semibold">₪{selectedProduct.base_price?.toLocaleString()}</span>
                  </p>
                  <Dialog open={isDialogOpen} onOpenChange={(open) => { 
                    setIsDialogOpen(open); 
                    if (!open) resetForm(); 
                  }}>
                    <DialogTrigger asChild>
                      <Button size="sm" className="">
                        <Plus className="h-4 w-4 me-2" />
                        הוסף מידה
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>{editingPrice ? 'עריכת מחיר מידה' : 'מחיר מידה חדש'}</DialogTitle>
                      </DialogHeader>
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <Label>מידה *</Label>
                          <Select value={formData.global_size_id} onValueChange={(v) => setFormData({ ...formData, global_size_id: v })}>
                            <SelectTrigger>
                              <SelectValue placeholder="בחר מידה..." />
                            </SelectTrigger>
                            <SelectContent>
                              {globalSizes.filter(s => s.is_active).map((size) => (
                                <SelectItem key={size.id} value={size.id}>
                                  {size.label} {size.dimensions ? `(${size.dimensions})` : ''}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
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
                          <p className="text-xs text-muted-foreground">
                            סה"כ: ₪{(selectedProduct.base_price + (formData.price_delta || 0))?.toLocaleString()}
                          </p>
                        </div>
                        <Button
                          className="w-full "
                          onClick={handleSubmit}
                          disabled={createSizePriceMutation.isPending || updateSizePriceMutation.isPending}
                        >
                          {(createSizePriceMutation.isPending || updateSizePriceMutation.isPending) && (
                            <Loader2 className="h-4 w-4 me-2 animate-spin" />
                          )}
                          {editingPrice ? 'עדכן' : 'הוסף'}
                        </Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>

                {loadingSizePrices ? (
                  <p className="text-muted-foreground text-center py-4">טוען...</p>
                ) : sizePrices.length === 0 ? (
                  <p className="text-muted-foreground text-center py-4">לא הוגדרו מידות עדיין</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-right">מידה</TableHead>
                        <TableHead className="text-right">תוספת</TableHead>
                        <TableHead className="text-right">סה"כ מחיר</TableHead>
                        <TableHead className="text-right">פעולות</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sizePrices.map((price) => (
                        <TableRow key={price.id}>
                          <TableCell className="font-medium">{getSizeName(price.global_size_id)}</TableCell>
                          <TableCell className={price.price_delta > 0 ? 'text-green-600' : price.price_delta < 0 ? 'text-red-600' : ''}>
                            {price.price_delta > 0 ? '+' : ''}{price.price_delta}
                          </TableCell>
                          <TableCell className="font-semibold">₪{(selectedProduct.base_price + price.price_delta)?.toLocaleString()}</TableCell>
                          <TableCell>
                            <div className="flex gap-2">
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
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </TabsContent>

              <TabsContent value="addons" className="space-y-4">
                <p className="text-sm text-muted-foreground">תוספות למוצר (כמו צבע, חומר וכו')</p>
                {loadingAddonPrices ? (
                  <p className="text-muted-foreground text-center py-4">טוען...</p>
                ) : addonPrices.length === 0 ? (
                  <p className="text-muted-foreground text-center py-4">לא הוגדרו תוספות עדיין</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-right">תוספת</TableHead>
                        <TableHead className="text-right">מחיר</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {addonPrices.map((price) => (
                        <TableRow key={price.id}>
                          <TableCell className="font-medium">{getAddonName(price.product_addon_id)}</TableCell>
                          <TableCell className="font-semibold">₪{price.price?.toLocaleString()}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </TabsContent>
            </Tabs>
          )}
        </CardContent>
      </Card>
    </div>
  );
}