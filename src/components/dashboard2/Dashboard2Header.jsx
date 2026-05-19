import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Clock, RefreshCw, LayoutDashboard } from 'lucide-react';
import { format } from '@/lib/safe-date-fns';
import Dashboard2DateRange from './Dashboard2DateRange';

export default function Dashboard2Header({
  rangeKey,
  dateRange,
  onPresetChange,
  onCustomChange,
  onRefresh,
  isFetching,
  lastUpdated,
}) {
  return (
    <Card className="border-border shadow-card">
      <CardContent className="p-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <LayoutDashboard className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-foreground">מרכז שליטה</h1>
              <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
                <Clock className="h-3 w-3" />
                עדכון אחרון: {lastUpdated ? format(lastUpdated, 'HH:mm:ss') : '--:--:--'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Dashboard2DateRange
              rangeKey={rangeKey}
              dateRange={dateRange}
              onPresetChange={onPresetChange}
              onCustomChange={onCustomChange}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={onRefresh}
              disabled={isFetching}
              className="h-9 text-xs gap-1.5"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
              רענן
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
