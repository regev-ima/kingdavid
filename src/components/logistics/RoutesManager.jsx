import React, { useState } from 'react';
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

export default function RoutesManager() {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingRoute, setEditingRoute] = useState(null);
  const queryClient = useQueryClient();

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
    },
  });

  const updateRouteMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.DeliveryRoute.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['routes']);
      setIsDialogOpen(false);
      setEditingRoute(null);
    },
  });

  const deleteRouteMutation = useMutation({
    mutationFn: (id) => base44.entities.DeliveryRoute.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['routes']);
    },
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    
    const activeDays = [];
    daysOfWeek.forEach(day => {
      if (formData.get(`day_${day.value}`)) {
        activeDays.push(day.value);
      }
    });

    const trucks = formData.get('truck_identifiers').split(',').map(t => t.trim()).filter(t => t);

    const routeData = {
      name: formData.get('name'),
      region: formData.get('region'),
      active_days: activeDays,
      capacity_pallets: parseInt(formData.get('capacity_pallets')),
      truck_identifiers: trucks,
      default_carrier: formData.get('default_carrier'),
      color: formData.get('color'),
      notes: formData.get('notes'),
      is_active: formData.get('is_active') === 'on',
    };

    if (editingRoute) {
      updateRouteMutation.mutate({ id: editingRoute.id, data: routeData });
    } else {
      createRouteMutation.mutate(routeData);
    }
  };

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
            
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label>שם המסלול *</Label>
                <Input 
                  name="name" 
                  defaultValue={editingRoute?.name}
                  placeholder="למשל: מסלול צפון א'"
                  required 
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>אזור גיאוגרפי *</Label>
                  <select 
                    name="region"
                    defaultValue={editingRoute?.region || 'center'}
                    className="w-full h-10 px-3 border rounded-md"
                    required
                  >
                    {regionOptions.map(region => (
                      <option key={region.value} value={region.value}>
                        {region.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label>קיבולת (משטחים) *</Label>
                  <Input 
                    name="capacity_pallets" 
                    type="number"
                    defaultValue={editingRoute?.capacity_pallets}
                    required 
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>ימי פעילות *</Label>
                <div className="grid grid-cols-4 gap-2">
                  {daysOfWeek.map(day => (
                    <div key={day.value} className="flex items-center gap-2">
                      <Checkbox 
                        id={`day_${day.value}`}
                        name={`day_${day.value}`}
                        defaultChecked={editingRoute?.active_days?.includes(day.value)}
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
                  name="truck_identifiers"
                  defaultValue={editingRoute?.truck_identifiers?.join(', ')}
                  placeholder="משאית 1, משאית 2"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>ספק משלוחים ברירת מחדל</Label>
                  <Input 
                    name="default_carrier"
                    defaultValue={editingRoute?.default_carrier}
                    placeholder="שם הספק"
                  />
                </div>
                <div className="space-y-2">
                  <Label>צבע</Label>
                  <select 
                    name="color"
                    defaultValue={editingRoute?.color || 'blue'}
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
                  name="notes"
                  defaultValue={editingRoute?.notes}
                  rows={2}
                />
              </div>

              <div className="flex items-center gap-2">
                <Switch 
                  id="is_active"
                  name="is_active"
                  defaultChecked={editingRoute?.is_active !== false}
                />
                <Label htmlFor="is_active">מסלול פעיל</Label>
              </div>

              <div className="flex justify-end gap-2 pt-4">
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                  ביטול
                </Button>
                <Button type="submit">
                  {editingRoute ? 'עדכן' : 'צור מסלול'}
                </Button>
              </div>
            </form>
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