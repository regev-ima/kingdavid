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
import { Plus, Edit, Trash2 } from 'lucide-react';

export default function GlobalSizesList() {
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingSize, setEditingSize] = useState(null);
  const [formData, setFormData] = useState({
    label: '',
    dimensions: '',
    price: 0,
    is_active: true,
    sort_order: 0
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
      price: 0,
      is_active: true,
      sort_order: 0
    });
    setEditingSize(null);
  };

  const handleEdit = (size) => {
    setEditingSize(size);
    setFormData({
      label: size.label,
      dimensions: size.dimensions || '',
      price: size.price !== undefined ? size.price : 0,
      is_active: size.is_active,
      sort_order: size.sort_order || 0
    });
    setIsDialogOpen(true);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (editingSize) {
      updateMutation.mutate({ id: editingSize.id, data: formData });
    } else {
      createMutation.mutate(formData);
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
                  onChange={(e) => setFormData({ ...formData, dimensions: e.target.value })}
                  placeholder='90x200 ס"מ'
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
                <TableCell className="text-right">{size.dimensions || '-'}</TableCell>
                <TableCell className="font-medium text-right">{size.label}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}