import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Plus, Edit, Trash2 } from 'lucide-react';

export default function ProductAddonsList() {
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingAddon, setEditingAddon] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    price: 0,
    is_active: true,
    sort_order: 0
  });

  const { data: addons = [], isLoading } = useQuery({
    queryKey: ['productAddons'],
    queryFn: () => base44.entities.ProductAddon.list('sort_order')
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.ProductAddon.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['productAddons']);
      setIsDialogOpen(false);
      resetForm();
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.ProductAddon.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['productAddons']);
      setIsDialogOpen(false);
      resetForm();
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.ProductAddon.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['productAddons']);
    }
  });

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      price: 0,
      is_active: true,
      sort_order: 0
    });
    setEditingAddon(null);
  };

  const handleEdit = (addon) => {
    setEditingAddon(addon);
    setFormData({
      name: addon.name,
      description: addon.description || '',
      price: addon.price !== undefined ? addon.price : 0,
      is_active: addon.is_active,
      sort_order: addon.sort_order || 0
    });
    setIsDialogOpen(true);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (editingAddon) {
      updateMutation.mutate({ id: editingAddon.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  if (isLoading) return <div>טוען...</div>;

  return (
    <Card dir="rtl">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>תוספות מוצרים גלובליות</CardTitle>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={resetForm} className="">
              <Plus className="h-4 w-4 mr-2" />
              הוסף תוספת
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingAddon ? 'ערוך תוספת' : 'תוספת חדשה'}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label>שם התוספת</Label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="ארגז מצעים, ראש מיטה..."
                  required
                />
              </div>
              <div>
                <Label>תיאור</Label>
                <Textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="תיאור התוספת..."
                />
              </div>
              <div>
                <Label>מחיר</Label>
                <Input
                  type="number"
                  value={formData.price}
                  onChange={(e) => setFormData({ ...formData, price: Number(e.target.value) })}
                  placeholder='0'
                />
              </div>
              <div>
                <Label>סדר תצוגה</Label>
                <Input
                  type="number"
                  value={formData.sort_order}
                  onChange={(e) => setFormData({ ...formData, sort_order: Number(e.target.value) })}
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
                  {editingAddon ? 'עדכן' : 'צור'}
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
              <TableHead className="text-right">תיאור</TableHead>
              <TableHead className="text-right">שם</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {addons.map((addon) => (
              <TableRow key={addon.id}>
                <TableCell>
                  <div className="flex gap-2 justify-end">
                    <Button size="sm" variant="ghost" onClick={() => handleEdit(addon)}>
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => deleteMutation.mutate(addon.id)}>
                      <Trash2 className="h-4 w-4 text-red-600" />
                    </Button>
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <span className={`px-2 py-1 rounded text-xs ${addon.is_active ? 'bg-green-100 text-green-800' : 'bg-muted text-muted-foreground'}`}>
                    {addon.is_active ? 'פעיל' : 'לא פעיל'}
                  </span>
                </TableCell>
                <TableCell className="text-right">{addon.sort_order}</TableCell>
                <TableCell className="text-right">₪{addon.price?.toLocaleString() || '0'}</TableCell>
                <TableCell className="text-right">{addon.description || '-'}</TableCell>
                <TableCell className="font-medium text-right">{addon.name}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}