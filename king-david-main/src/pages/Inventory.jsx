import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import DataTable from '@/components/shared/DataTable';
import FilterBar from '@/components/shared/FilterBar';
import KPICard from '@/components/shared/KPICard';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { Package, AlertTriangle, TrendingDown, Plus, ArrowUp, ArrowDown } from "lucide-react";
import { format } from 'date-fns';

const typeLabels = {
  raw_material: 'חומר גלם',
  finished_product: 'מוצר מוגמר',
  component: 'רכיב'
};

const filterOptions = [
  {
    key: 'type',
    label: 'סוג',
    options: [
      { value: 'raw_material', label: 'חומר גלם' },
      { value: 'finished_product', label: 'מוצר מוגמר' },
      { value: 'component', label: 'רכיב' },
    ]
  },
];

export default function Inventory() {
  const [activeTab, setActiveTab] = useState('all');
  const [filters, setFilters] = useState({ search: '', type: 'all' });
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isMoveDialogOpen, setIsMoveDialogOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [newItem, setNewItem] = useState({
    sku: '',
    name: '',
    type: 'raw_material',
    qty_on_hand: 0,
    min_threshold: 0,
    location: '',
    unit: 'units',
    cost_per_unit: 0,
  });
  const [movement, setMovement] = useState({
    movement_type: 'in',
    quantity: 0,
    reason: 'purchase',
    notes: '',
  });

  const queryClient = useQueryClient();

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['inventory'],
    queryFn: () => base44.entities.InventoryItem.list(),
  });

  const { data: movements = [] } = useQuery({
    queryKey: ['movements'],
    queryFn: () => base44.entities.InventoryMovement.list('-created_date', 50),
  });

  const createItemMutation = useMutation({
    mutationFn: (data) => base44.entities.InventoryItem.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['inventory']);
      setIsAddDialogOpen(false);
      setNewItem({
        sku: '', name: '', type: 'raw_material', qty_on_hand: 0, min_threshold: 0, location: '', unit: 'units', cost_per_unit: 0,
      });
    },
  });

  const createMovementMutation = useMutation({
    mutationFn: async (data) => {
      await base44.entities.InventoryMovement.create(data);
      // Update inventory quantity
      const newQty = data.movement_type === 'in' 
        ? selectedItem.qty_on_hand + data.quantity
        : selectedItem.qty_on_hand - data.quantity;
      await base44.entities.InventoryItem.update(selectedItem.id, { qty_on_hand: Math.max(0, newQty) });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['inventory']);
      queryClient.invalidateQueries(['movements']);
      setIsMoveDialogOpen(false);
      setSelectedItem(null);
      setMovement({ movement_type: 'in', quantity: 0, reason: 'purchase', notes: '' });
    },
  });

  let filteredItems = items;
  
  if (activeTab === 'low_stock') {
    filteredItems = filteredItems.filter(i => i.qty_on_hand <= (i.min_threshold || 0));
  } else if (activeTab === 'raw_material') {
    filteredItems = filteredItems.filter(i => i.type === 'raw_material');
  } else if (activeTab === 'finished_product') {
    filteredItems = filteredItems.filter(i => i.type === 'finished_product');
  }

  if (filters.search) {
    const searchLower = filters.search.toLowerCase();
    filteredItems = filteredItems.filter(i =>
      i.sku?.toLowerCase().includes(searchLower) ||
      i.name?.toLowerCase().includes(searchLower)
    );
  }
  if (filters.type && filters.type !== 'all') {
    filteredItems = filteredItems.filter(i => i.type === filters.type);
  }

  const totalItems = items.length;
  const lowStockItems = items.filter(i => i.qty_on_hand <= (i.min_threshold || 0)).length;
  const totalValue = items.reduce((sum, i) => sum + ((i.qty_on_hand || 0) * (i.cost_per_unit || 0)), 0);

  const columns = [
    {
      header: 'מק"ט',
      render: (row) => <span className="font-mono text-sm">{row.sku}</span>
    },
    {
      header: 'שם',
      render: (row) => (
        <div>
          <p className="font-medium">{row.name}</p>
          <p className="text-xs text-muted-foreground">{typeLabels[row.type]}</p>
        </div>
      )
    },
    {
      header: 'כמות',
      render: (row) => {
        const isLow = row.qty_on_hand <= (row.min_threshold || 0);
        return (
          <div className={`font-semibold ${isLow ? 'text-red-600' : ''}`}>
            {row.qty_on_hand} {row.unit}
            {isLow && <AlertTriangle className="inline h-4 w-4 ms-1" />}
          </div>
        );
      }
    },
    {
      header: 'סף מינימום',
      render: (row) => <span className="text-sm">{row.min_threshold || 0}</span>
    },
    {
      header: 'מיקום',
      render: (row) => <span className="text-sm">{row.location || '-'}</span>
    },
    {
      header: 'עלות',
      render: (row) => <span className="text-sm">₪{row.cost_per_unit?.toLocaleString() || 0}</span>
    },
    {
      header: 'פעולות',
      render: (row) => (
        <Button 
          variant="outline" 
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            setSelectedItem(row);
            setIsMoveDialogOpen(true);
          }}
        >
          תנועה
        </Button>
      )
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">מלאי</h1>
          <p className="text-muted-foreground">ניהול מלאי חומרי גלם ומוצרים</p>
        </div>
        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogTrigger asChild>
            <Button className="w-full sm:w-auto">
              <Plus className="h-4 w-4 me-2" />
              פריט חדש
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>הוסף פריט מלאי</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>מק"ט</Label>
                  <Input 
                    value={newItem.sku} 
                    onChange={(e) => setNewItem({...newItem, sku: e.target.value})}
                  />
                </div>
                <div className="space-y-2">
                  <Label>סוג</Label>
                  <Select 
                    value={newItem.type} 
                    onValueChange={(v) => setNewItem({...newItem, type: v})}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="raw_material">חומר גלם</SelectItem>
                      <SelectItem value="finished_product">מוצר מוגמר</SelectItem>
                      <SelectItem value="component">רכיב</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>שם</Label>
                <Input 
                  value={newItem.name} 
                  onChange={(e) => setNewItem({...newItem, name: e.target.value})}
                />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>כמות</Label>
                  <Input 
                    type="number"
                    value={newItem.qty_on_hand} 
                    onChange={(e) => setNewItem({...newItem, qty_on_hand: parseFloat(e.target.value)})}
                  />
                </div>
                <div className="space-y-2">
                  <Label>סף מינימום</Label>
                  <Input 
                    type="number"
                    value={newItem.min_threshold} 
                    onChange={(e) => setNewItem({...newItem, min_threshold: parseFloat(e.target.value)})}
                  />
                </div>
                <div className="space-y-2">
                  <Label>עלות</Label>
                  <Input 
                    type="number"
                    value={newItem.cost_per_unit} 
                    onChange={(e) => setNewItem({...newItem, cost_per_unit: parseFloat(e.target.value)})}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>מיקום</Label>
                <Input 
                  value={newItem.location} 
                  onChange={(e) => setNewItem({...newItem, location: e.target.value})}
                />
              </div>
              <Button 
                className="w-full"
                onClick={() => createItemMutation.mutate(newItem)}
                disabled={createItemMutation.isPending}
              >
                הוסף פריט
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="פריטים במלאי"
          value={totalItems}
          icon={Package}
          color="blue"
        />
        <KPICard
          title="חוסרים"
          value={lowStockItems}
          icon={AlertTriangle}
          color="red"
          onClick={() => setActiveTab('low_stock')}
        />
        <KPICard
          title="שווי מלאי"
          value={`₪${totalValue.toLocaleString()}`}
          icon={TrendingDown}
          color="emerald"
        />
        <KPICard
          title="תנועות היום"
          value={movements.filter(m => {
            const today = format(new Date(), 'yyyy-MM-dd');
            return format(new Date(m.created_date), 'yyyy-MM-dd') === today;
          }).length}
          icon={Package}
          color="amber"
        />
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-white border w-full h-auto flex flex-col sm:flex-row">
          <TabsTrigger value="all" className="w-full sm:w-auto">הכל ({items.length})</TabsTrigger>
          <TabsTrigger value="low_stock" className="text-red-600 w-full sm:w-auto">
            חוסרים ({lowStockItems})
          </TabsTrigger>
          <TabsTrigger value="raw_material" className="w-full sm:w-auto">חומרי גלם</TabsTrigger>
          <TabsTrigger value="finished_product" className="w-full sm:w-auto">מוצרים מוגמרים</TabsTrigger>
        </TabsList>
      </Tabs>

      <FilterBar
        filters={filterOptions}
        values={filters}
        onChange={(key, value) => setFilters(prev => ({ ...prev, [key]: value }))}
        onClear={() => setFilters({ search: '', type: 'all' })}
        searchPlaceholder='חפש לפי מק"ט או שם...'
      />

      <DataTable
        columns={columns}
        data={filteredItems}
        isLoading={isLoading}
        emptyMessage="לא נמצאו פריטי מלאי"
      />

      {/* Movement Dialog */}
      <Dialog open={isMoveDialogOpen} onOpenChange={setIsMoveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>תנועת מלאי - {selectedItem?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="p-3 bg-muted rounded-lg">
              <p className="text-sm text-muted-foreground">כמות נוכחית</p>
              <p className="text-xl font-bold">{selectedItem?.qty_on_hand} {selectedItem?.unit}</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>סוג תנועה</Label>
                <Select 
                  value={movement.movement_type} 
                  onValueChange={(v) => setMovement({...movement, movement_type: v})}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="in">כניסה</SelectItem>
                    <SelectItem value="out">יציאה</SelectItem>
                    <SelectItem value="adjust">התאמה</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>כמות</Label>
                <Input 
                  type="number"
                  value={movement.quantity} 
                  onChange={(e) => setMovement({...movement, quantity: parseFloat(e.target.value)})}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>סיבה</Label>
              <Select 
                value={movement.reason} 
                onValueChange={(v) => setMovement({...movement, reason: v})}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="purchase">רכישה</SelectItem>
                  <SelectItem value="production">ייצור</SelectItem>
                  <SelectItem value="return">החזרה</SelectItem>
                  <SelectItem value="damage">פגום</SelectItem>
                  <SelectItem value="adjustment">התאמה</SelectItem>
                  <SelectItem value="sale">מכירה</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>הערות</Label>
              <Input 
                value={movement.notes} 
                onChange={(e) => setMovement({...movement, notes: e.target.value})}
              />
            </div>
            <Button 
              className="w-full"
              onClick={() => createMovementMutation.mutate({
                ...movement,
                inventory_item_id: selectedItem.id,
                item_sku: selectedItem.sku,
                item_name: selectedItem.name,
              })}
              disabled={createMovementMutation.isPending}
            >
              {movement.movement_type === 'in' ? (
                <ArrowUp className="h-4 w-4 me-2" />
              ) : (
                <ArrowDown className="h-4 w-4 me-2" />
              )}
              בצע תנועה
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}