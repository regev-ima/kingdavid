import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, MapPin, Truck, Edit, Trash2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from 'sonner';

const daysOfWeek = [
  { value: 0, label: 'ראשון' },
  { value: 1, label: 'שני' },
  { value: 2, label: 'שלישי' },
  { value: 3, label: 'רביעי' },
  { value: 4, label: 'חמישי' },
  { value: 5, label: 'שישי' },
  { value: 6, label: 'שבת' },
];

const regionOptions = [
  { value: 'north', label: 'צפון' },
  { value: 'center', label: 'מרכז' },
  { value: 'sharon', label: 'שרון' },
  { value: 'shomron', label: 'שומרון' },
  { value: 'jerusalem', label: 'ירושלים' },
  { value: 'south', label: 'דרום' },
];

const colorOptions = [
  { value: 'blue', label: 'כחול', class: 'bg-blue-100 text-blue-800' },
  { value: 'green', label: 'ירוק', class: 'bg-green-100 text-green-800' },
  { value: 'purple', label: 'סגול', class: 'bg-purple-100 text-purple-800' },
  { value: 'orange', label: 'כתום', class: 'bg-orange-100 text-orange-800' },
  { value: 'pink', label: 'ורוד', class: 'bg-pink-100 text-pink-800' },
];

const EMPTY_FORM = {
  name: '',
  region: 'center',
  capacity_pallets: 20,
  active_days: [],
  truck_identifiers: '',
  default_carrier: '',
  color: 'blue',
  notes: '',
  is_active: true,
};

export default function RoutesManager() {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingRoute, setEditingRoute] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const queryClient = useQueryClient();

  // Sync form state when opening dialog for edit vs. create
  useEffect(() => {
    if (editingRoute) {
      setForm({
        name: editingRoute.name || '',
        region: editingRoute.region || 'center',
        capacity_pallets: editingRoute.capacity_pallets || 20,
        active_days: editingRoute.active_days || [],
        truck_identifiers: (editingRoute.truck_identifiers || []).join(', '),
        default_carrier: editingRoute.default_carrier || '',
        color: editingRoute.color || 'blue',
        notes: editingRoute.notes || '',
        is_active: editingRoute.is_active !== false,
      });
    } else {
      setForm(EMPTY_FORM);
    }
  }, [editingRoute, isDialogOpen]);

  const toggleDay = (dayValue) => {
    setForm((f) => ({
      ...f,
      active_days: f.active_days.includes(dayValue)
        ? f.active_days.filter((d) => d !== dayValue)
        : [...f.active_days, dayValue].sort((a, b) => a - b),
    }));
  };

  const { data: routes = [], isLoading } = useQuery({
    queryKey: ['routes'],
    queryFn: () => base44.entities.DeliveryRoute.list('-created_date'),
  });

  const createRouteMutation = useMutation({
    mutationFn: (data) => base44.entities.DeliveryRoute.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['routes']);
      setIsDialogOpen(false);
      setEditingRoute(null);
      toast.success('המסלול נוצר בהצלחה');
    },
    onError: (err) => {
      toast.error(`שגיאה ביצירת מסלול: ${err.message}`);
      console.error('createRoute error:', err);
    },
  });

  const updateRouteMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.DeliveryRoute.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['routes']);
      setIsDialogOpen(false);
      setEditingRoute(null);
      toast.success('המסלול עודכן');
    },
    onError: (err) => {
      toast.error(`שגיאה בעדכון מסלול: ${err.message}`);
      console.error('updateRoute error:', err);
    },
  });

  const deleteRouteMutation = useMutation({
    mutationFn: (id) => base44.entities.DeliveryRoute.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['routes']);
      toast.success('המסלול נמחק');
    },
    onError: (err) => {
      toast.error(`שגיאה במחיקת מסלול: ${err.message}`);
      console.error('deleteRoute error:', err);
    },
  });

  const handleSubmit = (e) => {
    if (e) e.preventDefault();

    // Client-side validation BEFORE hitting the DB, so the user always gets
    // a clear reason when nothing happens.
    if (!form.name?.trim()) {
      toast.error('יש להזין שם מסלול');
      return;
    }
    if (!form.region) {
      toast.error('יש לבחור אזור');
      return;
    }
    if (!form.capacity_pallets || form.capacity_pallets < 1) {
      toast.error('יש להזין מקסימום משלוחים (מספר חיובי)');
      return;
    }
    if (!form.active_days.length) {
      toast.error('יש לסמן לפחות יום פעילות אחד');
      return;
    }

    const trucks = form.truck_identifiers
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t);

    const routeData = {
      name: form.name.trim(),
      region: form.region,
      active_days: form.active_days,
      capacity_pallets: parseInt(form.capacity_pallets, 10),
      truck_identifiers: trucks,
      default_carrier: form.default_carrier?.trim() || null,
      color: form.color,
      notes: form.notes?.trim() || null,
      is_active: !!form.is_active,
    };

    console.log('RoutesManager submit →', editingRoute ? 'update' : 'create', routeData);

    if (editingRoute) {
      updateRouteMutation.mutate({ id: editingRoute.id, data: routeData });
    } else {
      createRouteMutation.mutate(routeData);
    }
  };

  const isSubmitting = createRouteMutation.isPending || updateRouteMutation.isPending;

  const getColorClass = (color) => {
    return colorOptions.find(c => c.value === color)?.class || 'bg-muted text-foreground';
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-foreground">מסלולי חלוקה</h2>
          <p className="text-muted-foreground text-sm">ניהול קווי חלוקה, אזורים וימי פעילות</p>
        </div>
        
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={() => setEditingRoute(null)}>
              <Plus className="h-4 w-4 me-2" />
              מסלול חדש
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingRoute ? 'עריכת מסלול' : 'מסלול חלוקה חדש'}</DialogTitle>
            </DialogHeader>
            
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>שם המסלול *</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="למשל: מסלול צפון א'"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>אזור גיאוגרפי *</Label>
                  <select
                    value={form.region}
                    onChange={(e) => setForm({ ...form, region: e.target.value })}
                    className="w-full h-10 px-3 border rounded-md"
                  >
                    {regionOptions.map(region => (
                      <option key={region.value} value={region.value}>
                        {region.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label>מקסימום משלוחים ליום *</Label>
                  <Input
                    type="number"
                    min="1"
                    placeholder="לדוגמא: 20"
                    value={form.capacity_pallets}
                    onChange={(e) => setForm({ ...form, capacity_pallets: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">
                    כמה משלוחים מקסימום אפשר להכניס למשאית אחת ביום חלוקה
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <Label>ימי פעילות *</Label>
                <div className="grid grid-cols-4 gap-2">
                  {daysOfWeek.map(day => (
                    <div key={day.value} className="flex items-center gap-2">
                      <Checkbox
                        id={`day_${day.value}`}
                        checked={form.active_days.includes(day.value)}
                        onCheckedChange={() => toggleDay(day.value)}
                      />
                      <label htmlFor={`day_${day.value}`} className="text-sm">
                        {day.label}
                      </label>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label>משאיות ייעודיות (הפרד בפסיקים)</Label>
                <Input
                  value={form.truck_identifiers}
                  onChange={(e) => setForm({ ...form, truck_identifiers: e.target.value })}
                  placeholder="משאית 1, משאית 2"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>ספק משלוחים ברירת מחדל</Label>
                  <Input
                    value={form.default_carrier}
                    onChange={(e) => setForm({ ...form, default_carrier: e.target.value })}
                    placeholder="שם הספק"
                  />
                </div>
                <div className="space-y-2">
                  <Label>צבע</Label>
                  <select
                    value={form.color}
                    onChange={(e) => setForm({ ...form, color: e.target.value })}
                    className="w-full h-10 px-3 border rounded-md"
                  >
                    {colorOptions.map(color => (
                      <option key={color.value} value={color.value}>
                        {color.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>הערות</Label>
                <Textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  rows={2}
                />
              </div>

              <div className="flex items-center gap-2">
                <Switch
                  id="is_active"
                  checked={form.is_active}
                  onCheckedChange={(checked) => setForm({ ...form, is_active: checked })}
                />
                <Label htmlFor="is_active">מסלול פעיל</Label>
              </div>

              <div className="flex justify-end gap-2 pt-4">
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                  ביטול
                </Button>
                <Button type="button" onClick={handleSubmit} disabled={isSubmitting}>
                  {isSubmitting ? 'שומר...' : (editingRoute ? 'עדכן' : 'צור מסלול')}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="text-center py-12">
          <p className="text-muted-foreground">טוען מסלולים...</p>
        </div>
      ) : routes.length === 0 ? (
        <Card>
          <CardContent className="text-center py-12">
            <Truck className="h-12 w-12 mx-auto mb-4 text-muted-foreground/70" />
            <p className="text-muted-foreground mb-4">עדיין לא הגדרת מסלולי חלוקה</p>
            <Button onClick={() => setIsDialogOpen(true)}>
              <Plus className="h-4 w-4 me-2" />
              צור מסלול ראשון
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid lg:grid-cols-2 gap-4">
          {routes.map(route => (
            <Card key={route.id}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`h-10 w-10 rounded-lg ${getColorClass(route.color)} flex items-center justify-center`}>
                      <MapPin className="h-5 w-5" />
                    </div>
                    <div>
                      <CardTitle>{route.name}</CardTitle>
                      <Badge variant={route.is_active ? "default" : "secondary"} className="mt-1">
                        {route.is_active ? 'פעיל' : 'לא פעיל'}
                      </Badge>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button 
                      size="icon" 
                      variant="ghost"
                      onClick={() => {
                        setEditingRoute(route);
                        setIsDialogOpen(true);
                      }}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button 
                      size="icon" 
                      variant="ghost"
                      onClick={() => {
                        if (confirm(`האם למחוק את המסלול "${route.name}"?`)) {
                          deleteRouteMutation.mutate(route.id);
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4 text-red-600" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <p className="text-sm text-muted-foreground mb-1">אזור</p>
                  <Badge variant="outline" className="text-base">
                    {regionOptions.find(r => r.value === route.region)?.label || route.region}
                  </Badge>
                </div>

                <div>
                  <p className="text-sm text-muted-foreground mb-1">ימי פעילות</p>
                  <div className="flex flex-wrap gap-1">
                    {route.active_days?.map((day) => (
                      <Badge key={day} variant="secondary">
                        {daysOfWeek.find(d => d.value === day)?.label}
                      </Badge>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 pt-2">
                  <div>
                    <p className="text-xs text-muted-foreground">קיבולת</p>
                    <p className="font-medium">{route.capacity_pallets} משטחים</p>
                  </div>
                  {route.default_carrier && (
                    <div>
                      <p className="text-xs text-muted-foreground">ספק</p>
                      <p className="font-medium">{route.default_carrier}</p>
                    </div>
                  )}
                </div>

                {route.truck_identifiers?.length > 0 && (
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">משאיות</p>
                    <div className="flex flex-wrap gap-1">
                      {route.truck_identifiers.map((truck, idx) => (
                        <Badge key={idx} variant="outline" className="text-xs">
                          <Truck className="h-3 w-3 me-1" />
                          {truck}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {route.notes && (
                  <p className="text-sm text-muted-foreground pt-2 border-t">{route.notes}</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}