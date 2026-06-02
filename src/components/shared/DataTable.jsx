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
  // Optional per-row className builder. Receives the row and returns
  // extra classes appended to the default row class — used to highlight
  // rows that meet a domain-specific condition (e.g. tasks due in the
  // next hour pulse-animate as "actionable now").
  rowClassName,
  selectionMode = false,
  onRowSelect,
  showRowNumbers = true,
  rowNumberStart = 1,
  tableClassName = '',
  dense = false,
}) {
  const cellPadding = dense ? 'py-2 px-3' : 'py-4 px-4';
  const headerPadding = dense ? 'py-2 px-3' : 'py-3';
  const stickyHeaderClass = 'sticky end-0 z-20 bg-muted/40';
  const stickyCellClass = 'sticky end-0 z-10 bg-card group-hover:bg-primary/[0.03] group-focus-within:bg-primary/[0.03] border-s border-border/40';

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
                    col.sticky && stickyHeaderClass,
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
              <TableRow key={i} className="border-b border-border/30 group">
                {showRowNumbers ? (
                  <TableCell className={cn(cellPadding, "text-center w-14")}>
                    <Skeleton className="h-4 w-8 rounded mx-auto" />
                  </TableCell>
                ) : null}
                {columns.map((col, idx) => (
                  <TableCell
                    key={idx}
                    className={cn(
                      cellPadding,
                      col.sticky && stickyCellClass,
                      col.cellClassName
                    )}
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
                    "text-center font-medium text-xs text-muted-foreground w-14 px-2",
                    headerPadding
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
                    "font-medium text-xs text-muted-foreground first:pr-4 last:pl-4",
                    headerPadding,
                    col.sticky && stickyHeaderClass,
                    col.headerClassName
                  )}
                  style={{
                    width: col.width,
                    paddingLeft: dense ? '0.75rem' : '1rem',
                    paddingRight: dense ? '0.75rem' : '1rem'
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
                className={`border-b border-border/50 last:border-b-0 group ${onRowClick || selectionMode ? 'cursor-pointer hover:bg-primary/[0.03] focus-within:bg-primary/[0.03]' : ''} transition-colors duration-150 ${rowClassName ? rowClassName(row, rowIdx) || '' : ''}`}
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
                  <TableCell className={cn(
                    "text-center px-2 text-sm text-muted-foreground font-semibold tabular-nums w-14",
                    cellPadding
                  )}>
                    {rowNumberStart + rowIdx}
                  </TableCell>
                ) : null}
                {columns.map((col, colIdx) => (
                  <TableCell
                    key={colIdx}
                    className={cn(
                      col.align === 'center' ? 'text-center' : 'text-right',
                      "text-sm text-foreground/80",
                      cellPadding,
                      col.sticky && stickyCellClass,
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