import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue } from
"@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow } from
"@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle } from
"@/components/ui/dialog";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger } from
"@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2, ChevronDown, ChevronLeft, AlertTriangle, Clock } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import ProductAddonsManager from "../components/product/ProductAddonsManager";

const categoryLabels = {
  mattress: 'מזרון',
  topper: 'תוספת',
  accessory: 'נלווה'
};

const bedTypeLabels = {
  single: 'יחיד',
  double: 'זוגי'
};

export default function ProductsNew() {
  const [expandedProducts, setExpandedProducts] = useState({});
  const [isProductDialogOpen, setIsProductDialogOpen] = useState(false);
  const [isVariationDialogOpen, setIsVariationDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [editingVariation, setEditingVariation] = useState(null);
  const [selectedProductId, setSelectedProductId] = useState(null);
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterBedType, setFilterBedType] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const queryClient = useQueryClient();

  const [productForm, setProductForm] = useState({
    name: '',
    category: 'mattress',
    description: '',
    image_url: '',
    default_variation_id: '',
    base_cost: '',
    production_time_days: '',
    warranty_years: '',
    is_active: true,
    manager_notes: '',
    has_trial_period: false
  });

  const [variationForm, setVariationForm] = useState({
    product_id: '',
    sku: '',
    length_cm: '',
    width_cm: '',
    height_cm: '',
    base_price: '',
    discount_percent: 0,
    stock_quantity: 0,
    min_stock_threshold: '',
    cost: '',
    is_active: true
  });

  const { data: products = [] } = useQuery({
    queryKey: ['products'],
    queryFn: () => base44.entities.Product.list('-created_date')
  });

  const { data: variations = [] } = useQuery({
    queryKey: ['product-variations'],
    queryFn: () => base44.entities.ProductVariation.list()
  });

  const createProductMutation = useMutation({
    mutationFn: (data) => base44.entities.Product.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['products']);
      setIsProductDialogOpen(false);
      resetProductForm();
    }
  });

  const updateProductMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Product.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['products']);
      setIsProductDialogOpen(false);
      resetProductForm();
    },
    onError: (err) => {
      console.error('Product update failed:', err);
      alert('שגיאה בעדכון המוצר: ' + (err.message || 'שגיאה לא ידועה'));
    }
  });

  const deleteProductMutation = useMutation({
    mutationFn: (id) => base44.entities.Product.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['products']);
    }
  });

  const createVariationMutation = useMutation({
    mutationFn: (data) => {
      const finalPrice = data.base_price * (1 - (data.discount_percent || 0) / 100);
      return base44.entities.ProductVariation.create({ ...data, final_price: finalPrice });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['product-variations']);
      setIsVariationDialogOpen(false);
      resetVariationForm();
    }
  });

  const updateVariationMutation = useMutation({
    mutationFn: ({ id, data }) => {
      const finalPrice = data.base_price * (1 - (data.discount_percent || 0) / 100);
      return base44.entities.ProductVariation.update(id, { ...data, final_price: finalPrice });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['product-variations']);
      setIsVariationDialogOpen(false);
      resetVariationForm();
    }
  });

  const deleteVariationMutation = useMutation({
    mutationFn: (id) => base44.entities.ProductVariation.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['product-variations']);
    }
  });

  const resetProductForm = () => {
    setProductForm({
      name: '',
      category: 'mattress',
      description: '',
      image_url: '',
      default_variation_id: '',
      base_cost: '',
      production_time_days: '',
      warranty_years: '',
      is_active: true,
      manager_notes: '',
      has_trial_period: false
    });
    setEditingProduct(null);
  };

  const resetVariationForm = () => {
    setVariationForm({
      product_id: '',
      sku: '',
      length_cm: '',
      width_cm: '',
      height_cm: '',
      base_price: '',
      discount_percent: 0,
      stock_quantity: 0,
      min_stock_threshold: '',
      cost: '',
      is_active: true
    });
    setEditingVariation(null);
  };

  const handleProductSubmit = (e) => {
    e.preventDefault();
    const cleanData = {
      ...productForm,
      base_cost: productForm.base_cost ? Number(productForm.base_cost) : null,
      production_time_days: productForm.production_time_days ? Number(productForm.production_time_days) : null,
      warranty_years: productForm.warranty_years ? Number(productForm.warranty_years) : null,
      default_variation_id: productForm.default_variation_id === 'none' ? '' : (productForm.default_variation_id || ''),
      manager_notes: productForm.manager_notes || '',
      has_trial_period: !!productForm.has_trial_period
    };

    if (editingProduct) {
      updateProductMutation.mutate({ id: editingProduct.id, data: cleanData });
    } else {
      createProductMutation.mutate(cleanData);
    }
  };

  const handleVariationSubmit = (e) => {
    e.preventDefault();
    const cleanData = {
      ...variationForm,
      length_cm: variationForm.length_cm ? Number(variationForm.length_cm) : null,
      width_cm: variationForm.width_cm ? Number(variationForm.width_cm) : null,
      height_cm: variationForm.height_cm ? Number(variationForm.height_cm) : null,
      base_price: Number(variationForm.base_price),
      discount_percent: Number(variationForm.discount_percent || 0),
      stock_quantity: Number(variationForm.stock_quantity || 0),
      min_stock_threshold: variationForm.min_stock_threshold ? Number(variationForm.min_stock_threshold) : null,
      cost: variationForm.cost ? Number(variationForm.cost) : null
    };

    if (editingVariation) {
      updateVariationMutation.mutate({ id: editingVariation.id, data: cleanData });
    } else {
      createVariationMutation.mutate(cleanData);
    }
  };

  const handleEditProduct = (product) => {
    setEditingProduct(product);
    setProductForm({
      name: product.name || '',
      category: product.category || 'mattress',
      description: product.description || '',
      image_url: product.image_url || '',
      default_variation_id: product.default_variation_id || '',
      base_cost: product.base_cost || '',
      production_time_days: product.production_time_days || '',
      warranty_years: product.warranty_years || '',
      is_active: product.is_active !== false,
      manager_notes: product.manager_notes || '',
      has_trial_period: product.has_trial_period || false
    });
    setIsProductDialogOpen(true);
  };

  const handleEditVariation = (variation) => {
    setEditingVariation(variation);
    setVariationForm({
      product_id: variation.product_id || '',
      sku: variation.sku || '',
      length_cm: variation.length_cm || '',
      width_cm: variation.width_cm || '',
      height_cm: variation.height_cm || '',
      base_price: variation.base_price || '',
      discount_percent: variation.discount_percent || 0,
      stock_quantity: variation.stock_quantity || 0,
      min_stock_threshold: variation.min_stock_threshold || '',
      cost: variation.cost || '',
      is_active: variation.is_active !== false
    });
    setIsVariationDialogOpen(true);
  };

  const handleAddVariation = (productId) => {
    setSelectedProductId(productId);
    setVariationForm({ ...variationForm, product_id: productId });
    setIsVariationDialogOpen(true);
  };

  const toggleExpand = (productId) => {
    setExpandedProducts((prev) => ({
      ...prev,
      [productId]: !prev[productId]
    }));
  };

  const getProductVariations = (productId) => {
    return variations.filter((v) => v.product_id === productId);
  };

  const filteredProducts = products.filter((p) => {
    const matchesCategory = filterCategory === 'all' || p.category === filterCategory;
    const matchesBedType = filterBedType === 'all' || p.bed_type === filterBedType;
    const matchesSearch = !searchTerm ||
    p.name?.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesCategory && matchesBedType && matchesSearch;
  });

  const requiresDimensions = productForm.category === 'mattress' || productForm.category === 'topper';

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <h1 className="text-3xl font-bold">קטלוג מוצרים</h1>
        <Button onClick={() => {resetProductForm();setIsProductDialogOpen(true);}} className="w-full sm:w-auto">
          <Plus className="h-4 w-4 me-2" />
          מוצר חדש
        </Button>
      </div>

      <Tabs defaultValue="products" className="w-full">
        <TabsList className="w-full h-auto flex flex-col sm:flex-row">
          <TabsTrigger value="products" className="w-full sm:w-auto">מוצרים ווריאציות</TabsTrigger>
          <TabsTrigger value="addons" className="w-full sm:w-auto">תוספות</TabsTrigger>
        </TabsList>

        <TabsContent value="products" className="space-y-6">

      {/* Product Dialog */}
      <Dialog open={isProductDialogOpen} onOpenChange={setIsProductDialogOpen}>
        <DialogContent className="max-w-2xl" dir="rtl">
          <DialogHeader>
            <DialogTitle>{editingProduct ? 'עריכת מוצר' : 'מוצר חדש'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleProductSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>שם המוצר *</Label>
                <Input
                      value={productForm.name}
                      onChange={(e) => setProductForm({ ...productForm, name: e.target.value })}
                      placeholder="מזרון פרסטיז'"
                      required />

              </div>
              <div>
                <Label>קטגוריה *</Label>
                <Select value={productForm.category} onValueChange={(val) => setProductForm({ ...productForm, category: val })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mattress">מזרון</SelectItem>
                    <SelectItem value="topper">תוספת</SelectItem>
                    <SelectItem value="accessory">מוצר נלווה</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label>תיאור</Label>
              <Textarea
                    value={productForm.description}
                    onChange={(e) => setProductForm({ ...productForm, description: e.target.value })}
                    rows={3} />

            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label>עלות בסיס</Label>
                <Input
                      type="number"
                      value={productForm.base_cost}
                      onChange={(e) => setProductForm({ ...productForm, base_cost: e.target.value })} />

              </div>
              <div>
                <Label>זמן ייצור (ימים)</Label>
                <Input
                      type="number"
                      value={productForm.production_time_days}
                      onChange={(e) => setProductForm({ ...productForm, production_time_days: e.target.value })} />

              </div>
              <div>
                <Label>שנות אחריות</Label>
                <Input
                      type="number"
                      value={productForm.warranty_years}
                      onChange={(e) => setProductForm({ ...productForm, warranty_years: e.target.value })} />

              </div>
            </div>

            <div>
              <Label>קישור תמונה</Label>
              <Input
                    value={productForm.image_url}
                    onChange={(e) => setProductForm({ ...productForm, image_url: e.target.value })}
                    placeholder="https://..." />

            </div>

            {editingProduct &&
                <div>
                <Label>וריאציית ברירת מחדל</Label>
                <Select
                    value={productForm.default_variation_id}
                    onValueChange={(val) => setProductForm({ ...productForm, default_variation_id: val })}>

                  <SelectTrigger>
                    <SelectValue placeholder="בחר וריאציה..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">ללא ברירת מחדל</SelectItem>
                    {getProductVariations(editingProduct.id).map((v) =>
                      <SelectItem key={v.id} value={v.id}>
                        {v.sku} - {v.length_cm}×{v.width_cm}×{v.height_cm}
                      </SelectItem>
                      )}
                  </SelectContent>
                </Select>
              </div>
                }

            <div>
              <Label>הערת מנהל</Label>
              <Textarea
                value={productForm.manager_notes}
                onChange={(e) => setProductForm({ ...productForm, manager_notes: e.target.value })}
                rows={2}
                placeholder="הערה פנימית למנהלים..."
                className="text-sm"
              />
            </div>

            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={productForm.is_active}
                  onChange={(e) => setProductForm({ ...productForm, is_active: e.target.checked })}
                  className="h-4 w-4"
                />
                <Label>פעיל</Label>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={productForm.has_trial_period}
                  onChange={(e) => setProductForm({ ...productForm, has_trial_period: e.target.checked })}
                  className="h-4 w-4"
                />
                <Label>30 ימי נסיון</Label>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <Button type="button" variant="outline" onClick={() => setIsProductDialogOpen(false)}>
                ביטול
              </Button>
              <Button type="submit">
                {editingProduct ? 'עדכן' : 'צור מוצר'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Variation Dialog */}
      <Dialog open={isVariationDialogOpen} onOpenChange={setIsVariationDialogOpen}>
        <DialogContent className="max-w-2xl" dir="rtl">
          <DialogHeader>
            <DialogTitle>{editingVariation ? 'עריכת וריאציה' : 'וריאציה חדשה'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleVariationSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>מק"ט *</Label>
                <Input
                      value={variationForm.sku}
                      onChange={(e) => setVariationForm({ ...variationForm, sku: e.target.value })}
                      placeholder="MAT-PRES-140-190"
                      required />

              </div>
            </div>

            <div className="grid grid-cols-3 gap-4 p-4 bg-muted rounded-lg">
              <div>
                <Label>אורך (ס"מ)</Label>
                <Input
                      type="number"
                      value={variationForm.length_cm}
                      onChange={(e) => setVariationForm({ ...variationForm, length_cm: e.target.value })} />

              </div>
              <div>
                <Label>רוחב (ס"מ)</Label>
                <Input
                      type="number"
                      value={variationForm.width_cm}
                      onChange={(e) => setVariationForm({ ...variationForm, width_cm: e.target.value })} />

              </div>
              <div>
                <Label>גובה (ס"מ)</Label>
                <Input
                      type="number"
                      value={variationForm.height_cm}
                      onChange={(e) => setVariationForm({ ...variationForm, height_cm: e.target.value })} />

              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label>מחיר לפני מע״מ *</Label>
                <Input
                      type="number"
                      value={variationForm.base_price}
                      onChange={(e) => setVariationForm({ ...variationForm, base_price: e.target.value })}
                      required />

              </div>
              <div>
                <Label>אחוז הנחה (%)</Label>
                <Input
                      type="number"
                      value={variationForm.discount_percent}
                      onChange={(e) => setVariationForm({ ...variationForm, discount_percent: e.target.value })} />

              </div>
              <div>
                <Label>מחיר סופי (מחושב)</Label>
                <Input
                      value={variationForm.base_price && variationForm.discount_percent ?
                      (variationForm.base_price * (1 - variationForm.discount_percent / 100)).toFixed(2) :
                      variationForm.base_price || '0'}
                      disabled
                      className="bg-muted" />

              </div>
            </div>

            <div className="grid grid-cols-1 gap-4">
              <div>
                <Label>מחיר כולל מע״מ 18% (לקריאה בלבד)</Label>
                <Input
                      value={(() => {
                        const finalPrice = variationForm.base_price && variationForm.discount_percent ?
                          variationForm.base_price * (1 - variationForm.discount_percent / 100) :
                          Number(variationForm.base_price) || 0;
                        return finalPrice ? `₪${Math.round(finalPrice * 1.18).toLocaleString()}` : '₪0';
                      })()}
                      disabled
                      className="bg-muted font-semibold" />

              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label>כמות במלאי</Label>
                <Input
                      type="number"
                      value={variationForm.stock_quantity}
                      onChange={(e) => setVariationForm({ ...variationForm, stock_quantity: e.target.value })} />

              </div>
              <div>
                <Label>סף מינימום</Label>
                <Input
                      type="number"
                      value={variationForm.min_stock_threshold}
                      onChange={(e) => setVariationForm({ ...variationForm, min_stock_threshold: e.target.value })} />

              </div>
              <div>
                <Label>עלות ייצור</Label>
                <Input
                      type="number"
                      value={variationForm.cost}
                      onChange={(e) => setVariationForm({ ...variationForm, cost: e.target.value })} />

              </div>
            </div>

            <div className="flex items-center gap-2">
              <input
                    type="checkbox"
                    checked={variationForm.is_active}
                    onChange={(e) => setVariationForm({ ...variationForm, is_active: e.target.checked })}
                    className="h-4 w-4" />

              <Label>פעיל</Label>
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <Button type="button" variant="outline" onClick={() => setIsVariationDialogOpen(false)}>
                ביטול
              </Button>
              <Button type="submit">
                {editingVariation ? 'עדכן' : 'צור וריאציה'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader>
          <div className="flex flex-col md:flex-row items-stretch md:items-center gap-4">
            <Input
                  placeholder='חיפוש לפי שם מוצר...'
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full md:max-w-xs" />

            <Select value={filterCategory} onValueChange={setFilterCategory}>
              <SelectTrigger className="w-full md:w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">כל הקטגוריות</SelectItem>
                <SelectItem value="mattress">מזרונים</SelectItem>
                <SelectItem value="topper">תוספות</SelectItem>
                <SelectItem value="accessory">נלווים</SelectItem>
              </SelectContent>
            </Select>

            <Select value={filterBedType} onValueChange={setFilterBedType}>
              <SelectTrigger className="w-full md:w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">יחיד + זוגי</SelectItem>
                <SelectItem value="single">יחיד</SelectItem>
                <SelectItem value="double">זוגי</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {filteredProducts.map((product) => {
                  const productVariations = getProductVariations(product.id);
                  const isExpanded = expandedProducts[product.id];

                  return (
                    <div key={product.id} className={`border rounded-xl overflow-hidden transition-shadow ${isExpanded ? 'shadow-md' : 'hover:shadow-sm'}`}>
                  <button
                    type="button"
                    dir="rtl"
                    className="w-full flex items-center justify-between p-4 bg-white hover:bg-muted/30 transition-colors"
                    onClick={() => toggleExpand(product.id)}
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className={`w-2 h-10 rounded-full flex-shrink-0 ${product.is_active ? 'bg-emerald-400' : 'bg-gray-300'}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <h3 className="font-bold text-base text-foreground">{product.name}</h3>
                          <Badge variant="outline" className="text-[10px]">{categoryLabels[product.category]}</Badge>
                          {product.bed_type && (
                            <Badge className={`text-[10px] ${product.bed_type === 'double' ? 'bg-purple-100 text-purple-700' : 'bg-cyan-100 text-cyan-700'}`}>
                              {bedTypeLabels[product.bed_type] || product.bed_type}
                            </Badge>
                          )}
                          <TooltipProvider delayDuration={200}>
                          {product.has_trial_period && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="inline-flex items-center gap-1 bg-amber-100 text-amber-700 text-[10px] font-semibold px-1.5 py-0.5 rounded-md">
                                  <Clock className="h-3 w-3" /> 30 ימי נסיון
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>למוצר זה יש 30 ימי נסיון</TooltipContent>
                            </Tooltip>
                          )}
                          {product.manager_notes && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="inline-flex items-center gap-1 bg-orange-100 text-orange-700 text-[10px] font-semibold px-1.5 py-0.5 rounded-md cursor-help">
                                  <AlertTriangle className="h-3 w-3" /> הערה
                                </span>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs text-right" dir="rtl">
                                <p className="font-semibold mb-1">הערת מנהל:</p>
                                <p>{product.manager_notes}</p>
                              </TooltipContent>
                            </Tooltip>
                          )}
                          </TooltipProvider>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-muted-foreground">{productVariations.length} מידות</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <Button
                        variant="outline"
                        size="sm"
                        className="whitespace-nowrap h-8 text-xs"
                        onClick={(e) => { e.stopPropagation(); handleAddVariation(product.id); }}
                      >
                        <Plus className="h-3 w-3 me-1" /> מידה
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => { e.stopPropagation(); handleEditProduct(product); }}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => {
                        e.stopPropagation();
                        if (confirm('האם אתה בטוח? פעולה זו תמחק גם את כל הוריאציות')) {
                          deleteProductMutation.mutate(product.id);
                        }
                      }}>
                        <Trash2 className="h-3.5 w-3.5 text-red-500" />
                      </Button>
                      <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${isExpanded ? '' : '-rotate-90'}`} />
                    </div>
                  </button>

                  {isExpanded &&
                      <div className="px-4 pb-4 pt-2 overflow-x-auto border-t border-border/30 bg-muted/10">
                      {productVariations.length > 0 ?
                        <Table className="min-w-[600px]" dir="rtl">
                          <TableHeader>
                            <TableRow>
                              <TableHead className="text-right">מק"ט</TableHead>
                              <TableHead className="text-right">מידות</TableHead>
                              <TableHead className="text-right">לפני מע״מ</TableHead>
                              <TableHead className="text-right">כולל מע״מ</TableHead>
                              <TableHead className="text-right">מלאי</TableHead>
                              <TableHead className="text-right">סטטוס</TableHead>
                              <TableHead className="text-right">פעולות</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {productVariations.map((variation) =>
                            <TableRow key={variation.id} className={variation.id === product.default_variation_id ? 'bg-primary/5' : ''}>
                                <TableCell className="font-mono">
                                  {variation.sku}
                                  {variation.id === product.default_variation_id &&
                                <Badge className="ms-2 bg-primary">ברירת מחדל</Badge>
                                }
                                </TableCell>
                                <TableCell className="font-medium">
                                  {variation.width_cm && variation.length_cm ?
                                `${variation.width_cm}×${variation.length_cm}` :
                                '-'}
                                </TableCell>
                                <TableCell>
                                  <div>
                                    <div className="font-semibold">₪{variation.final_price?.toLocaleString()}</div>
                                    {variation.discount_percent > 0 &&
                                  <div className="text-xs text-muted-foreground line-through">
                                        ₪{variation.base_price?.toLocaleString()}
                                      </div>
                                  }
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <div className="font-semibold text-muted-foreground">
                                    ₪{variation.final_price ? Math.round(variation.final_price * 1.18).toLocaleString() : '-'}
                                  </div>
                                </TableCell>
                                <TableCell className="bg-transparent text-foreground p-2 align-middle [&:has([role=checkbox])]:pe-0 [&>[role=checkbox]]:translate-y-[2px]">
                                  <Badge
                                  variant={variation.stock_quantity > (variation.min_stock_threshold || 0) ? "default" : "destructive"} className="bg-primary text-primary-foreground px-2.5 py-0.5 text-xs font-semibold rounded-md inline-flex items-center border transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 border-transparent shadow hover:bg-primary/80">

                                    {variation.stock_quantity}
                                  </Badge>
                                </TableCell>
                                <TableCell>
                                  {variation.is_active ?
                                <Badge className="bg-green-100 text-green-800">פעיל</Badge> :

                                <Badge variant="secondary">לא פעיל</Badge>
                                }
                                </TableCell>
                                <TableCell>
                                  <div className="flex gap-2">
                                    <Button variant="ghost" size="icon" onClick={() => handleEditVariation(variation)}>
                                      <Pencil className="h-4 w-4" />
                                    </Button>
                                    <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => {
                                      if (confirm('האם אתה בטוח שברצונך למחוק וריאציה זו?')) {
                                        deleteVariationMutation.mutate(variation.id);
                                      }
                                    }}>

                                      <Trash2 className="h-4 w-4 text-red-600" />
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            )}
                          </TableBody>
                        </Table> :

                        <div className="text-center py-8 text-muted-foreground">
                          אין וריאציות למוצר זה. לחץ על "הוסף וריאציה" כדי להתחיל.
                        </div>
                        }
                    </div>
                      }
                </div>);

                })}
            
            {filteredProducts.length === 0 &&
                <div className="text-center py-12 text-muted-foreground">
                לא נמצאו מוצרים
              </div>
                }
          </div>
          </CardContent>
        </Card>
        </TabsContent>

        <TabsContent value="addons">
          <Card>
            <CardHeader>
              <CardTitle>ניהול תוספות</CardTitle>
            </CardHeader>
            <CardContent>
              <ProductAddonsManager />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>);

}