import React from 'react';
import DataTable from '@/components/shared/DataTable';
import StatusBadge from '@/components/shared/StatusBadge';
import { Checkbox } from '@/components/ui/checkbox';
import { format } from '@/lib/safe-date-fns';
import { SOURCE_LABELS } from '@/constants/leadOptions';
import { LAST_OPENED_ROW_CLASS } from '@/components/lead/LeadModalContext';

// The leads table used by ניהול לידים — extracted so other screens (e.g. the
// Marketing leads report) render the exact same columns and open a lead the
// same way (row click → openLead popup). Pass `isAdmin` to toggle the bulk
// selection checkbox column; omit the selection props for a read-only view.
function formatPhone(p) {
  if (!p) return '';
  const cleaned = p.replace(/\D/g, '');
  return cleaned.length === 10 ? `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}-${cleaned.slice(6)}` : p;
}

export default function LeadListTable({
  leads,
  isLoading,
  isAdmin = false,
  selectedLeads = [],
  onSelectionChange,
  repNameByEmail = new Map(),
  onRowClick,
  highlightId,
  emptyMessage = 'לא נמצאו לידים תואמים',
}) {
  const allSelected = selectedLeads.length > 0 && selectedLeads.length === leads.length;
  const someSelected = selectedLeads.length > 0 && !allSelected;
  const toggleAll = (checked) => onSelectionChange?.(checked ? leads.map((l) => l.id) : []);
  const toggleOne = (id, checked) => onSelectionChange?.(
    checked ? [...selectedLeads, id] : selectedLeads.filter((x) => x !== id),
  );

  const columns = [
    ...(isAdmin && onSelectionChange ? [{
      header: () => (
        <div className="flex items-center justify-center">
          <Checkbox
            checked={allSelected ? true : someSelected ? 'indeterminate' : false}
            onCheckedChange={(c) => toggleAll(!!c)}
          />
        </div>
      ),
      accessor: 'select',
      align: 'center',
      width: '52px',
      render: (row) => (
        <div className="flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
          <Checkbox
            checked={selectedLeads.includes(row.id)}
            onCheckedChange={(c) => toggleOne(row.id, !!c)}
          />
        </div>
      ),
    }] : []),
    {
      header: 'לקוח',
      accessor: 'full_name',
      width: '260px',
      render: (row) => (
        <div className="min-w-0">
          <p className="text-sm font-medium truncate" title={row.full_name || ''}>{row.full_name || '—'}</p>
          <p className="text-xs text-muted-foreground truncate" dir="ltr" title={row.phone || ''}>{formatPhone(row.phone)}</p>
        </div>
      ),
    },
    {
      header: 'סטטוס',
      width: '140px',
      render: (row) => row.status ? <StatusBadge status={row.status} /> : '—',
    },
    {
      header: 'מקור',
      width: '120px',
      render: (row) => (
        <p className="text-xs text-muted-foreground truncate" title={row.source ? (SOURCE_LABELS[row.source] || row.source) : ''}>
          {row.source ? (SOURCE_LABELS[row.source] || row.source) : '—'}
        </p>
      ),
    },
    {
      header: 'נציג מטפל',
      width: '160px',
      render: (row) => {
        if (!row.rep1) return <span className="text-xs text-amber-700">לא משויך</span>;
        const name = repNameByEmail.get(row.rep1) || row.rep1;
        return <p className="text-sm truncate" title={name}>{name}</p>;
      },
    },
    {
      header: 'תאריך פעילות',
      width: '120px',
      render: (row) => {
        try {
          const d = row.effective_sort_date || row.created_date;
          return d ? <span className="text-xs text-muted-foreground">{format(new Date(d), 'dd/MM/yyyy')}</span> : '—';
        } catch { return '—'; }
      },
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={leads}
      isLoading={isLoading}
      emptyMessage={emptyMessage}
      onRowClick={onRowClick}
      rowClassName={(row) => (row.id === highlightId ? LAST_OPENED_ROW_CLASS : '')}
      tableClassName="w-full table-fixed min-w-[720px]"
    />
  );
}
