import React from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { Inbox } from "lucide-react";

export default function DataTable({
  columns,
  data,
  isLoading,
  emptyMessage = 'אין נתונים להצגה',
  onRowClick,
  selectionMode = false,
  onRowSelect,
  showRowNumbers = true,
  rowNumberStart = 1,
  tableClassName = '',
}) {
  if (isLoading) {
    return (
      <div className="rounded-xl border border-black/[0.06] bg-card overflow-hidden shadow-card">
        <div className="overflow-x-auto">
        <Table className={tableClassName}>
          <TableHeader>
            <TableRow className="bg-muted/40 border-b border-border">
              {showRowNumbers ? (
                <TableHead className="text-center font-semibold text-[11px] uppercase tracking-wider text-muted-foreground py-2.5 px-3 w-14">
                  #
                </TableHead>
              ) : null}
              {columns.map((col, idx) => (
                <TableHead
                  key={idx}
                  className={cn(
                    "text-right font-semibold text-[11px] uppercase tracking-wider text-muted-foreground py-2.5 px-3",
                    col.headerClassName
                  )}
                >
                  {typeof col.header === 'function' ? col.header() : col.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {[1, 2, 3, 4, 5].map((i) => (
              <TableRow key={i} className="border-b border-border/30">
                {showRowNumbers ? (
                  <TableCell className="py-3 px-3 text-center w-14">
                    <Skeleton className="h-4 w-8 rounded mx-auto" />
                  </TableCell>
                ) : null}
                {columns.map((col, idx) => (
                  <TableCell
                    key={idx}
                    className={cn("py-3 px-3", col.cellClassName)}
                  >
                    <Skeleton className="h-4 w-full rounded" />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </div>
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="rounded-xl border border-black/[0.06] bg-card p-12 text-center shadow-card">
        <Inbox className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
        <p className="text-muted-foreground text-sm">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-black/[0.06] bg-card overflow-hidden shadow-card">
      <div className="overflow-x-auto">
        <Table className={tableClassName}>
          <TableHeader>
            <TableRow className="bg-muted/40 border-b border-border">
              {showRowNumbers ? (
                <TableHead
                  className={cn(
                    "text-center font-medium text-xs text-muted-foreground py-3 w-14",
                    "px-2"
                  )}
                >
                  #
                </TableHead>
              ) : null}
              {columns.map((col, idx) => (
                <TableHead
                  key={idx}
                  className={cn(
                    col.align === 'center' ? 'text-center' : 'text-right',
                    "font-medium text-xs text-muted-foreground py-3 first:pr-4 last:pl-4",
                    col.headerClassName
                  )}
                  style={{ 
                    width: col.width,
                    paddingLeft: '1rem',
                    paddingRight: '1rem'
                  }}
                >
                  {typeof col.header === 'function' ? col.header() : col.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((row, rowIdx) => (
              <TableRow
                key={row.id || rowIdx}
                className={`border-b border-border/50 last:border-b-0 group ${onRowClick || selectionMode ? 'cursor-pointer hover:bg-primary/[0.03] focus-within:bg-primary/[0.03]' : ''} transition-colors duration-150`}
                onClick={() => {
                  if (selectionMode && onRowSelect) {
                    onRowSelect(row);
                  } else if (onRowClick) {
                    onRowClick(row);
                  }
                }}
                onKeyDown={(e) => { if ((onRowClick || selectionMode) && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); selectionMode && onRowSelect ? onRowSelect(row) : onRowClick?.(row); } }}
                tabIndex={onRowClick ? 0 : undefined}
                role={onRowClick ? 'button' : undefined}
              >
                {showRowNumbers ? (
                  <TableCell className="text-center py-4 px-2 text-sm text-muted-foreground font-semibold tabular-nums w-14">
                    {rowNumberStart + rowIdx}
                  </TableCell>
                ) : null}
                {columns.map((col, colIdx) => (
                  <TableCell
                    key={colIdx}
                    className={cn(
                      col.align === 'center' ? 'text-center' : 'text-right',
                      "py-4 px-4 text-sm text-foreground/80",
                      col.cellClassName
                    )}
                    style={col.width ? { width: col.width } : undefined}
                  >
                    {col.render ? col.render(row) : row[col.accessor]}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}