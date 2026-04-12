import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Edit, Trash2, Loader2 } from "lucide-react";

export default function GlobalPricingManager() {
  const [pricingTab, setPricingTab] = useState('sizes');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [formData, setFormData] = useState({
    label: '',
    dimensions: '',
    price: 0,
    is_active: true,
    sort_order: 0,
  });

  const queryClient = useQueryClient();

  // Fetch global sizes
  const { data: globalSizes = [], isLoading: loadingSizes } = useQuery({
    queryKey: ['globalSizes'],
    queryFn: () => base44.entities.GlobalSize.list('sort_order'),
  });

  // Fetch product addons
  const { data: productAddons = [], isLoading: loadingAddons } = useQuery({
    queryKey: ['productAddons'],
    queryFn: () => base44.entities.ProductAddon.list('sort_order'),
  });

  // Mutations for sizes
  const createSizeMutation = useMutation({
    mutationFn: (data) => base44.entities.GlobalSize.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['globalSizes']);
      setIsDialogOpen(false);
      resetForm();
    },
  });

  const updateSizeMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.GlobalSize.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['globalSizes']);
      setIsDialogOpen(false);
      resetForm();
    },
  });

  const deleteSizeMutation = useMutation({
    mutationFn: (id) => base44.entities.GlobalSize.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['globalSizes']);
    },
  });

  // Mutations for addons
  const createAddonMutation = useMutation({
    mutationFn: (data) => base44.entities.ProductAddon.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['productAddons']);
      setIsDialogOpen(false);
      resetForm();
    },
  });

  const updateAddonMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.ProductAddon.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['productAddons']);
      setIsDialogOpen(false);
      resetForm();
    },
  });

  const deleteAddonMutation = useMutation({
    mutationFn: (id) => base44.entities.ProductAddon.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['productAddons']);
    },
  });

  const resetForm = () => {
    setEditingItem(null);
    setFormData({
      label: '',
      dimensions: '',
      price: 0,
      is_active: true,
      sort_order: 0,
    });
  };

  const handleEditSize = (size) => {
    setEditingItem(size);
    setFormData({
      label: size.label,
      dimensions: size.dimensions || '',
      price: size.price || 0,
      is_active: size.is_active ?? true,
      sort_order: size.sort_order || 0,
    });
    setIsDialogOpen(true);
  };

  const handleEditAddon = (addon) => {
    setEditingItem(addon);
    setFormData({
      label: addon.name,
      dimensions: addon.description || '',
      price: addon.price || 0,
      is_active: addon.is_active ?? true,
      sort_order: addon.sort_order || 0,
    });
    setIsDialogOpen(true);
  };

  const handleSubmitSize = () => {
    if (!formData.label) return;
    
    if (editingItem && editingItem.id) {
      updateSizeMutation.mutate({
        id: editingItem.id,
        data: {
          label: formData.label,
          dimensions: formData.dimensions,
          price: parseFloat(formData.price) || 0,
          is_active: formData.is_active,
          sort_order: parseInt(formData.sort_order) || 0,
        },
      });
    } else {
      createSizeMutation.mutate({
        label: formData.label,
        dimensions: formData.dimensions,
        price: parseFloat(formData.price) || 0,
        is_active: formData.is_active,
        sort_order: parseInt(formData.sort_order) || 0,
      });
    }
  };

  const handleSubmitAddon = () => {
    if (!formData.label) return;
    
    if (editingItem && editingItem.id) {
      updateAddonMutation.mutate({
        id: editingItem.id,
        data: {
          name: formData.label,
          description: formData.dimensions,
          price: parseFloat(formData.price) || 0,
          is_active: formData.is_active,
          sort_order: parseInt(formData.sort_order) || 0,
        },
      });
    } else {
      createAddonMutation.mutate({
        name: formData.label,
        description: formData.dimensions,
        price: parseFloat(formData.price) || 0,
        is_active: formData.is_active,
        sort_order: parseInt(formData.sort_order) || 0,
      });
    }
  };

  const handleDeleteSize = (id) => {
    if (confirm('האם אתה בטוח?')) {
      deleteSizeMutation.mutate(id);
    }
  };

  const handleDeleteAddon = (id) => {
    if (confirm('האם אתה בטוח?')) {
      deleteAddonMutation.mutate(id);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>ניהול מחירון גלובלי</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs value={pricingTab} onValueChange={setPricingTab}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="sizes">מידות</TabsTrigger>
              <TabsTrigger value="addons">תוספות</TabsTrigger>
            </TabsList>

            {/* Sizes Tab */}
            <TabsContent value="sizes" className="space-y-4">
              <div className="flex justify-end">
                <Dialog open={isDialogOpen && pricingTab === 'sizes'} onOpenChange={(open) => {
                  setIsDialogOpen(open);
                  if (!open) resetForm();
                }}>
                  <DialogTrigger asChild>
                    <Button className="" onClick={() => {
                      resetForm();
                      setEditingItem(null);
                    }}>
                      <Plus className="h-4 w-4 me-2" />
                      מידה חדשה
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>{editingItem ? 'עריכת מידה' : 'מידה חדשה'}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label>שם המידה *</Label>
                        <Input
                          value={formData.label}
                          onChange={(e) => setFormData({ ...formData, label: e.target.value })}
                          placeholder="למשל: יחיד, זוגי, קווין וכו'"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>מימדים</Label>
                        <Input
                          value={formData.dimensions}
                          onChange={(e) => setFormData({ ...formData, dimensions: e.target.value })}
                          placeholder="למשל: 90x200 ס״מ"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>מחיר</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={formData.price}
                          onChange={(e) => setFormData({ ...formData, price: parseFloat(e.target.value) || 0 })}
                          placeholder="0"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>סדר תצוגה</Label>
                        <Input
                          type="number"
                          value={formData.sort_order}
                          onChange={(e) => setFormData({ ...formData, sort_order: parseInt(e.target.value) || 0 })}
                          placeholder="0"
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <Label>פעיל</Label>
                        <Switch
                          checked={formData.is_active}
                          onCheckedChange={(v) => setFormData({ ...formData, is_active: v })}
                        />
                      </div>
                      <Button
                        className="w-full "
                        onClick={handleSubmitSize}
                        disabled={createSizeMutation.isPending || updateSizeMutation.isPending}
                      >
                        {(createSizeMutation.isPending || updateSizeMutation.isPending) && (
                          <Loader2 className="h-4 w-4 me-2 animate-spin" />
                        )}
                        {editingItem ? 'עדכן' : 'הוסף'}
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>

              {loadingSizes ? (
                <p className="text-muted-foreground text-center py-4">טוען...</p>
              ) : globalSizes.length === 0 ? (
                <p className="text-muted-foreground text-center py-4">אין מידות</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-right">שם</TableHead>
                      <TableHead className="text-right">מימדים</TableHead>
                      <TableHead className="text-right">מחיר</TableHead>
                      <TableHead className="text-right">סדר</TableHead>
                      <TableHead className="text-right">פעיל</TableHead>
                      <TableHead className="text-right">פעולות</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {globalSizes.map((size) => (
                      <TableRow key={size.id}>
                        <TableCell className="font-medium">{size.label}</TableCell>
                        <TableCell>{size.dimensions}</TableCell>
                        <TableCell className="font-semibold">₪{size.price?.toLocaleString()}</TableCell>
                        <TableCell>{size.sort_order}</TableCell>
                        <TableCell>{size.is_active ? '✓' : '✗'}</TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            <Button variant="ghost" size="sm" onClick={() => handleEditSize(size)}>
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDeleteSize(size.id)}
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

            {/* Addons Tab */}
            <TabsContent value="addons" className="space-y-4">
              <div className="flex justify-end">
                <Dialog open={isDialogOpen && pricingTab === 'addons'} onOpenChange={(open) => {
                  setIsDialogOpen(open);
                  if (!open) resetForm();
                }}>
                  <DialogTrigger asChild>
                    <Button className="" onClick={() => {
                      resetForm();
                      setEditingItem(null);
                    }}>
                      <Plus className="h-4 w-4 me-2" />
                      תוספת חדשה
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>{editingItem ? 'עריכת תוספת' : 'תוספת חדשה'}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label>שם התוספת *</Label>
                        <Input
                          value={formData.label}
                          onChange={(e) => setFormData({ ...formData, label: e.target.value })}
                          placeholder="למשל: ארגז מצעים, ראש מיטה"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>תיאור</Label>
                        <Input
                          value={formData.dimensions}
                          onChange={(e) => setFormData({ ...formData, dimensions: e.target.value })}
                          placeholder="תיאור התוספת"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>מחיר</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={formData.price}
                          onChange={(e) => setFormData({ ...formData, price: parseFloat(e.target.value) || 0 })}
                          placeholder="0"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>סדר תצוגה</Label>
                        <Input
                          type="number"
                          value={formData.sort_order}
                          onChange={(e) => setFormData({ ...formData, sort_order: parseInt(e.target.value) || 0 })}
                          placeholder="0"
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <Label>פעיל</Label>
                        <Switch
                          checked={formData.is_active}
                          onCheckedChange={(v) => setFormData({ ...formData, is_active: v })}
                        />
                      </div>
                      <Button
                        className="w-full "
                        onClick={handleSubmitAddon}
                        disabled={createAddonMutation.isPending || updateAddonMutation.isPending}
                      >
                        {(createAddonMutation.isPending || updateAddonMutation.isPending) && (
                          <Loader2 className="h-4 w-4 me-2 animate-spin" />
                        )}
                        {editingItem ? 'עדכן' : 'הוסף'}
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>

              {loadingAddons ? (
                <p className="text-muted-foreground text-center py-4">טוען...</p>
              ) : productAddons.length === 0 ? (
                <p className="text-muted-foreground text-center py-4">אין תוספות</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-right">שם</TableHead>
                      <TableHead className="text-right">תיאור</TableHead>
                      <TableHead className="text-right">מחיר</TableHead>
                      <TableHead className="text-right">סדר</TableHead>
                      <TableHead className="text-right">פעיל</TableHead>
                      <TableHead className="text-right">פעולות</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {productAddons.map((addon) => (
                      <TableRow key={addon.id}>
                        <TableCell className="font-medium">{addon.name}</TableCell>
                        <TableCell className="text-sm">{addon.description}</TableCell>
                        <TableCell className="font-semibold">₪{addon.price?.toLocaleString()}</TableCell>
                        <TableCell>{addon.sort_order}</TableCell>
                        <TableCell>{addon.is_active ? '✓' : '✗'}</TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            <Button variant="ghost" size="sm" onClick={() => handleEditAddon(addon)}>
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDeleteAddon(addon.id)}
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
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}