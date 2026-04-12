import React from 'react';
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, X } from "lucide-react";

export default function FilterBar({ 
  filters, 
  values, 
  onChange, 
  onClear,
  searchPlaceholder = 'חיפוש...' 
}) {
  const hasActiveFilters = Object.values(values).some(v => v && v !== 'all');

  return (
    <div className="bg-card rounded-2xl border border-border p-4 shadow-card">
      <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-3">
        <div className="relative flex-1 min-w-0 sm:min-w-[250px] sm:max-w-md">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={searchPlaceholder}
            value={values.search || ''}
            onChange={(e) => onChange('search', e.target.value)}
            className="pr-10"
            aria-label={searchPlaceholder}
          />
        </div>

        {filters.map((filter) => (
          <Select
            key={filter.key}
            value={values[filter.key] || 'all'}
            onValueChange={(value) => onChange(filter.key, value)}
          >
            <SelectTrigger className="w-full sm:w-[160px]">
              <SelectValue placeholder={filter.label} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">כל {filter.label}</SelectItem>
              {filter.options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ))}

        {hasActiveFilters && (
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={onClear}
            className="text-muted-foreground hover:text-destructive hover:bg-destructive/5"
          >
            <X className="h-4 w-4 me-1" />
            נקה
          </Button>
        )}
      </div>
    </div>
  );
}