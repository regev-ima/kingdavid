import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
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

export default function ExtraCharges() {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingCharge, setEditingCharge] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    cost: 0,
    is_active: true,
  });

  const queryClient = useQueryClient();

  const { data: extraCharges = [], isLoading } = useQuery({
    queryKey: ['extraCharges'],
    queryFn: () => base44.entities.ExtraCharge.list('-sort_order'),
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.ExtraCharge.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['extraCharges']);
      setIsDialogOpen(false);
      resetForm();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.ExtraCharge.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['extraCharges']);
      setIsDialogOpen(false);
      resetForm();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.ExtraCharge.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['extraCharges']);
    },
  });

  const resetForm = () => {
    setFormData({ name: '', description: '', cost: 0, is_active: true });
    setEditingCharge(null);
  };

  const handleEdit = (charge) => {
    setEditingCharge(charge);
    setFormData({
      name: charge.name,
      description: charge.description || '',
      cost: charge.cost,
      is_active: charge.is_active,
    });
    setIsDialogOpen(true);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (editingCharge) {
      updateMutation.mutate({ id: editingCharge.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">תוספות להזמנות</h1>
          <p className="text-muted-foreground">נהל תוספות כמו הובלה, קומה, מנוף וכו'</p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button className="w-full sm:w-auto" onClick={resetForm}>
              <Plus className="h-4 w-4 me-2" />
              הוסף תוספת
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingCharge ? 'ערוך תוספת' : 'תוספת חדשה'}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label>שם התוספת *</Label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({...formData, name: e.target.value})}
                  placeholder="הובלה, קומה, מנוף..."
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>תיאור</Label>
                <Textarea
                  value={formData.description}
                  onChange={(e) => setFormData({...formData, description: e.target.value})}
                  placeholder="תיאור התוספת"
                  rows={2}
                />
              </div>
              <div className="space-y-2">
                <Label>עלות *</Label>
                <Input
                  type="number"
                  min="0"
                  value={formData.cost}
                  onChange={(e) => setFormData({...formData, cost: parseFloat(e.target.value) || 0})}
                  required
                />
              </div>
              <div className="flex items-center gap-3">
                <Switch
                  checked={formData.is_active}
                  onCheckedChange={(v) => setFormData({...formData, is_active: v})}
                />
                <Label className="cursor-pointer">פעיל</Label>
              </div>
              <div className="flex justify-end gap-3">
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                  ביטול
                </Button>
                <Button 
                  type="submit"
                  className=""
                  disabled={createMutation.isPending || updateMutation.isPending}
                >
                  {(createMutation.isPending || updateMutation.isPending) ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    editingCharge ? 'עדכן' : 'צור'
                  )}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-0">
          {/* Mobile View */}
          <div className="md:hidden flex flex-col p-4 space-y-4">
            {isLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : extraCharges.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                אין תוספות. הוסף תוספת ראשונה
              </div>
            ) : (
              extraCharges.map((charge) => (
                <div key={charge.id} className="border rounded-lg p-4 space-y-3 bg-white shadow-sm">
                  <div className="flex justify-between items-start">
                    <h3 className="font-bold text-lg">{charge.name}</h3>
                    <span className={`inline-block px-2 py-1 rounded text-xs ${
                      charge.is_active 
                        ? 'bg-green-100 text-green-800' 
                        : 'bg-muted text-foreground'
                    }`}>
                      {charge.is_active ? 'פעיל' : 'לא פעיל'}
                    </span>
                  </div>
                  {charge.description && (
                    <p className="text-muted-foreground text-sm">{charge.description}</p>
                  )}
                  <div className="font-semibold text-lg">
                    ₪{charge.cost.toLocaleString()}
                  </div>
                  <div className="flex items-center gap-2 pt-3 border-t">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleEdit(charge)}
                      className="text-primary flex-1 bg-primary/5 hover:bg-primary/10"
                    >
                      <Edit className="h-4 w-4 me-2" />
                      ערוך
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        if (confirm('למחוק תוספת זו?')) {
                          deleteMutation.mutate(charge.id);
                        }
                      }}
                      className="text-red-600 flex-1 bg-red-50 hover:bg-red-100"
                    >
                      <Trash2 className="h-4 w-4 me-2" />
                      מחק
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Desktop View */}
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted">
                  <TableHead className="text-start">שם</TableHead>
                  <TableHead className="text-start">תיאור</TableHead>
                  <TableHead className="text-start">עלות</TableHead>
                  <TableHead className="text-start">סטטוס</TableHead>
                  <TableHead className="text-start w-32">פעולות</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin mx-auto text-primary" />
                    </TableCell>
                  </TableRow>
                ) : extraCharges.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                      אין תוספות. הוסף תוספת ראשונה
                    </TableCell>
                  </TableRow>
                ) : (
                  extraCharges.map((charge) => (
                    <TableRow key={charge.id}>
                      <TableCell className="font-medium">{charge.name}</TableCell>
                      <TableCell className="text-muted-foreground">{charge.description || '-'}</TableCell>
                      <TableCell className="font-semibold">₪{charge.cost.toLocaleString()}</TableCell>
                      <TableCell>
                        <span className={`inline-block px-2 py-1 rounded text-xs ${
                          charge.is_active 
                            ? 'bg-green-100 text-green-800' 
                            : 'bg-muted text-foreground'
                        }`}>
                          {charge.is_active ? 'פעיל' : 'לא פעיל'}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleEdit(charge)}
                            className="text-primary"
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              if (confirm('למחוק תוספת זו?')) {
                                deleteMutation.mutate(charge.id);
                              }
                            }}
                            className="text-red-600"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}