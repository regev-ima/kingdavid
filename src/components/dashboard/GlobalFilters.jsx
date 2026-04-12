import React from 'react';
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Filter, RotateCcw } from "lucide-react";

const DATE_PRESETS = [
  { value: 'today', label: 'היום' },
  { value: 'yesterday', label: 'אתמול' },
  { value: '7days', label: '7 ימים אחרונים' },
  { value: '30days', label: '30 ימים אחרונים' },
  { value: 'current_month', label: 'חודש נוכחי' },
  { value: 'last_month', label: 'חודש קודם' },
  { value: 'custom', label: 'טווח מותאם' },
];

const SOURCE_OPTIONS = [
  { value: 'store', label: 'חנות' },
  { value: 'callcenter', label: 'מוקד' },
  { value: 'digital', label: 'דיגיטל' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'referral', label: 'הפניה' },
];

const LEAD_STATUS_OPTIONS = [
  { value: 'new', label: 'חדש' },
  { value: 'assigned', label: 'משויך' },
  { value: 'contacted', label: 'נוצר קשר' },
  { value: 'qualified', label: 'מתאים' },
  { value: 'quote_sent', label: 'הצעה נשלחה' },
  { value: 'negotiating', label: 'במו"מ' },
  { value: 'won', label: 'נסגר בהצלחה' },
  { value: 'lost', label: 'אבוד' },
];

export default function GlobalFilters({ filters, onChange, users = [] }) {
  const salesReps = users.filter(u => u.role === 'user' || u.role === 'admin');
  
  const handleReset = () => {
    onChange({
      datePreset: 'today',
      dateFrom: '',
      dateTo: '',
      rep: 'all',
      source: 'all',
      leadStatus: 'all',
      pipelineStage: 'all',
    });
  };

  const hasActiveFilters = 
    filters.rep !== 'all' || 
    filters.source !== 'all' || 
    filters.leadStatus !== 'all' ||
    filters.pipelineStage !== 'all';

  return (
    <div className="rounded-xl border border-black/[0.06] bg-card p-4 shadow-card">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-md bg-primary/10">
            <Filter className="h-4 w-4 text-primary" />
          </div>
          <h3 className="font-semibold text-sm text-foreground">פילטרים</h3>
        </div>
        {hasActiveFilters && (
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={handleReset}
            className="text-muted-foreground hover:text-red-600 hover:bg-red-50 h-7 text-xs"
          >
            <RotateCcw className="h-3.5 w-3.5 me-1" />
            אפס
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">טווח זמן</Label>
          <Select 
            value={filters.datePreset} 
            onValueChange={(val) => onChange({ ...filters, datePreset: val })}
          >
            <SelectTrigger className="h-8 text-xs border-border bg-muted/50">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DATE_PRESETS.map(preset => (
                <SelectItem key={preset.value} value={preset.value}>
                  {preset.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {filters.datePreset === 'custom' && (
          <>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">מתאריך</Label>
              <Input
                type="date"
                value={filters.dateFrom}
                onChange={(e) => onChange({ ...filters, dateFrom: e.target.value })}
                className="h-8 text-xs border-border bg-muted/50"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">עד תאריך</Label>
              <Input
                type="date"
                value={filters.dateTo}
                onChange={(e) => onChange({ ...filters, dateTo: e.target.value })}
                className="h-8 text-xs border-border bg-muted/50"
              />
            </div>
          </>
        )}

        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">נציג</Label>
          <Select 
            value={filters.rep} 
            onValueChange={(val) => onChange({ ...filters, rep: val })}
          >
            <SelectTrigger className="h-8 text-xs border-border bg-muted/50">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">כל הנציגים</SelectItem>
              {salesReps.map(rep => (
                <SelectItem key={rep.id} value={rep.email}>
                  {rep.full_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">מקור</Label>
          <Select 
            value={filters.source} 
            onValueChange={(val) => onChange({ ...filters, source: val })}
          >
            <SelectTrigger className="h-8 text-xs border-border bg-muted/50">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">כל המקורות</SelectItem>
              {SOURCE_OPTIONS.map(src => (
                <SelectItem key={src.value} value={src.value}>
                  {src.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">סטטוס ליד</Label>
          <Select 
            value={filters.leadStatus} 
            onValueChange={(val) => onChange({ ...filters, leadStatus: val })}
          >
            <SelectTrigger className="h-8 text-xs border-border bg-muted/50">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">כל הסטטוסים</SelectItem>
              {LEAD_STATUS_OPTIONS.map(status => (
                <SelectItem key={status.value} value={status.value}>
                  {status.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}