import React, { useMemo, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';


import DataTable from '@/components/shared/DataTable';
import StatusBadge from '@/components/shared/StatusBadge';
import { Copy, Receipt, Search, FileCheck2, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { format } from '@/lib/safe-date-fns';
import useEffectiveCurrentUser from '@/hooks/use-effective-current-user';
import { canAccessBookkeepingWorkspace } from '@/lib/rbac';
import { copyToClipboard } from '@/utils/clipboard';

// Hover-style copy button used next to almost every cell value. Reusing
// the same shape so the column matrix doesn't sprout 20 different
// "copy this" presentations.
function CopyButton({ value, label }) {
  if (value === null || value === undefined || value === '' || value === '-') return null;
  return (
    <button
      type="button"
      onClick={(e) => copyToClipboard(e, value, label)}
      className="inline-flex items-center justify-center h-6 w-6 rounded-md text-muted-foreground/60 hover:text-foreground hover:bg-muted transition-colors flex-shrink-0"
      title={`העתק ${label}`}
    >
      <Copy className="h-3 w-3" />
    </button>
  );
}

// Picks the most informative confirmation values from the payments array
// (hyp = the gateway used by orders today). We surface the *most recent*
// payment's transaction id and approval code, since that's typically the
// one the bookkeeper is invoicing against.
function lastPaymentRefs(order) {
  const payments = Array.isArray(order?.payments) ? order.payments : [];
  if (payments.length === 0) return { transactionId: null, approvalCode: null };
  // Prefer the last payment that actually has a transaction id.
  for (let i = payments.length - 1; i >= 0; i -= 1) {
    const p = payments[i];
    if (p?.hyp_transaction_id || p?.hyp_acode) {
      return {
        transactionId: p.hyp_transaction_id || null,
        approvalCode: p.hyp_acode || null,
      };
    }
  }
  return { transactionId: null, approvalCode: null };
}

function productSummary(order) {
  const items = Array.isArray(order?.items) ? order.items : [];
  if (items.length === 0) return '—';
  const first = items[0]?.name || items[0]?.sku || 'מוצר';
  if (items.length === 1) return first;
  return `${first} (+${items.length - 1})`;
}

export default function Bookkeeping() {
  const queryClient = useQueryClient();
  const { effectiveUser, isLoading: isLoadingUser } = useEffectiveCurrentUser();
  const canAccess = canAccessBookkeepingWorkspace(effectiveUser);

  const [activeTab, setActiveTab] = useState('pending');
  const [search, setSearch] = useState('');
  // Local edit buffer for the in-row invoice number input so typing
  // doesn't fire a save on every keystroke — saves on blur / Enter.
  const [invoiceDrafts, setInvoiceDrafts] = useState({});

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['bookkeeping-orders'],
    queryFn: () => base44.entities.Order.list('-created_date', 1000),
    enabled: canAccess,
    staleTime: 30_000,
  });

  const updateOrderMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Order.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bookkeeping-orders'] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
    onError: (err) => {
      // The toggle used to fail silently when the orders table didn't
      // yet have the invoice_* columns — supabase rejected the PATCH
      // and nothing surfaced. Surface it now with a useful Hebrew
      // message + the raw error for the console so the diagnosis is
      // immediate rather than "the button is broken".
      const message = err?.message || String(err) || 'שגיאה לא ידועה';
      const missingColumn =
        /column .*(invoice_issued|invoice_number|invoice_issued_at).*does not exist/i.test(message) ||
        /could not find the (.*) column/i.test(message);
      if (missingColumn) {
        toast.error(
          'הטבלה עוד לא עודכנה — צריך להריץ את המיגרציה האחרונה (invoice_issued וכו׳)',
          { duration: 8000 },
        );
      } else {
        toast.error(`שמירה נכשלה: ${message}`);
      }
      console.error('Bookkeeping order update failed', err);
    },
  });

  const counts = useMemo(() => {
    const total = orders.length;
    const issued = orders.filter((o) => o.invoice_issued === true).length;
    return { total, issued, pending: total - issued };
  }, [orders]);

  const filtered = useMemo(() => {
    let list = orders;
    if (activeTab === 'pending') list = list.filter((o) => o.invoice_issued !== true);
    else if (activeTab === 'issued') list = list.filter((o) => o.invoice_issued === true);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (o) =>
          (o.order_number || '').toLowerCase().includes(q) ||
          (o.customer_name || '').toLowerCase().includes(q) ||
          (o.customer_phone || '').includes(search) ||
          (o.invoice_number || '').toLowerCase().includes(q),
      );
    }
    return list;
  }, [orders, activeTab, search]);

  const handleToggleIssued = (order, nextValue) => {
    updateOrderMutation.mutate({
      id: order.id,
      data: {
        invoice_issued: nextValue,
        invoice_issued_at: nextValue ? new Date().toISOString() : null,
      },
    });
  };

  const handleSaveInvoiceNumber = (order) => {
    const draft = invoiceDrafts[order.id];
    if (draft === undefined) return;
    if (draft === (order.invoice_number || '')) return;
    updateOrderMutation.mutate({
      id: order.id,
      data: { invoice_number: draft || null },
    });
    setInvoiceDrafts((prev) => {
      const next = { ...prev };
      delete next[order.id];
      return next;
    });
  };

  const columns = useMemo(
    () => [
      {
        header: 'מס׳ הזמנה',
        accessor: 'order_number',
        width: '130px',
        render: (row) => (
          <div className="flex items-center gap-1 min-w-0">
            <span className="font-medium text-primary truncate" dir="ltr">#{row.order_number}</span>
            <CopyButton value={row.order_number} label="מס׳ הזמנה" />
          </div>
        ),
      },
      {
        header: 'לקוח',
        width: '220px',
        render: (row) => (
          <div className="min-w-0">
            <div className="flex items-center gap-1 min-w-0">
              <p className="font-medium truncate">{row.customer_name || '—'}</p>
              <CopyButton value={row.customer_name} label="שם הלקוח" />
            </div>
            {row.customer_phone && (
              <div className="flex items-center gap-1 min-w-0">
                <p className="text-xs text-muted-foreground whitespace-nowrap" dir="ltr">{row.customer_phone}</p>
                <CopyButton value={row.customer_phone} label="טלפון" />
              </div>
            )}
          </div>
        ),
      },
      {
        header: 'מוצר',
        width: '200px',
        render: (row) => {
          const summary = productSummary(row);
          return (
            <div className="flex items-center gap-1 min-w-0">
              <span className="text-sm truncate">{summary}</span>
              <CopyButton value={summary} label="מוצר" />
            </div>
          );
        },
      },
      {
        header: 'סכום',
        width: '110px',
        render: (row) => {
          const value = row.total;
          if (value === null || value === undefined) return <span className="text-muted-foreground">—</span>;
          return (
            <div className="flex items-center gap-1 whitespace-nowrap">
              <span className="font-semibold tabular-nums">₪{Number(value).toLocaleString()}</span>
              <CopyButton value={value} label="סכום" />
            </div>
          );
        },
      },
      {
        header: 'תשלום',
        width: '110px',
        render: (row) => <StatusBadge status={row.payment_status} />,
      },
      {
        header: 'מס׳ עסקה',
        width: '150px',
        render: (row) => {
          const { transactionId } = lastPaymentRefs(row);
          if (!transactionId) return <span className="text-muted-foreground text-xs">—</span>;
          return (
            <div className="flex items-center gap-1">
              <span className="text-sm tabular-nums" dir="ltr">{transactionId}</span>
              <CopyButton value={transactionId} label="מס׳ עסקה" />
            </div>
          );
        },
      },
      {
        header: 'מס׳ אישור',
        width: '130px',
        render: (row) => {
          const { approvalCode } = lastPaymentRefs(row);
          if (!approvalCode) return <span className="text-muted-foreground text-xs">—</span>;
          return (
            <div className="flex items-center gap-1">
              <span className="text-sm tabular-nums" dir="ltr">{approvalCode}</span>
              <CopyButton value={approvalCode} label="מס׳ אישור" />
            </div>
          );
        },
      },
      {
        header: 'תאריך',
        width: '110px',
        render: (row) => (
          <span className="text-sm text-muted-foreground whitespace-nowrap">
            {row.created_date ? format(new Date(row.created_date), 'dd/MM/yyyy') : '—'}
          </span>
        ),
      },
      {
        header: 'חשבונית',
        width: '230px',
        render: (row) => {
          const issued = row.invoice_issued === true;
          const draft = invoiceDrafts[row.id] ?? (row.invoice_number || '');
          return (
            <div className="space-y-1.5" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center gap-2">
                <Switch
                  checked={issued}
                  onCheckedChange={(checked) => handleToggleIssued(row, checked === true)}
                  aria-label="הוצאה חשבונית"
                />
                <span className={`text-xs font-medium ${issued ? 'text-emerald-700' : 'text-muted-foreground'}`}>
                  {issued ? 'הוצאה' : 'ממתינה'}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <Input
                  value={draft}
                  onChange={(e) =>
                    setInvoiceDrafts((prev) => ({ ...prev, [row.id]: e.target.value }))
                  }
                  onBlur={() => handleSaveInvoiceNumber(row)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.currentTarget.blur();
                    }
                  }}
                  placeholder="מס׳ חשבונית"
                  className="h-7 text-xs flex-1 min-w-0"
                  dir="ltr"
                />
                <CopyButton value={row.invoice_number} label="מס׳ חשבונית" />
              </div>
            </div>
          );
        },
      },
      // עמודת "סיגמא" (שליחה לסיגמא) הוסרה עד שהאינטגרציה תיבנה בפועל —
      // כפתור מושבת עם "בקרוב" אינו רלוונטי למסירה.
    ],
    [invoiceDrafts],
  );

  if (isLoadingUser) return <div className="text-center py-12">טוען...</div>;
  if (!canAccess) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">אין לך הרשאה לאזור הנהלת חשבונות</p>
      </div>
    );
  }

  return (
    <div className="space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-border/50">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Receipt className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-foreground leading-tight">הנהלת חשבונות</h1>
            <p className="text-sm text-muted-foreground/70 mt-0.5">
              מעקב אחר חשבוניות עבור הזמנות שנפתחו במערכת
            </p>
          </div>
        </div>
      </div>

      {/* KPI strip — at-a-glance snapshot */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-border bg-card p-4 shadow-card">
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" /> ממתינות
          </p>
          <p className="text-2xl font-bold text-amber-600 tabular-nums mt-1">{counts.pending.toLocaleString()}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 shadow-card">
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <FileCheck2 className="h-3.5 w-3.5" /> הוצאה
          </p>
          <p className="text-2xl font-bold text-emerald-600 tabular-nums mt-1">{counts.issued.toLocaleString()}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 shadow-card">
          <p className="text-xs text-muted-foreground">סה״כ הזמנות</p>
          <p className="text-2xl font-bold text-foreground tabular-nums mt-1">{counts.total.toLocaleString()}</p>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} dir="rtl">
        <TabsList className="w-full h-auto p-1 gap-1 bg-muted/80 rounded-xl">
          <TabsTrigger
            value="pending"
            className="flex-1 h-11 px-4 rounded-lg text-sm font-semibold data-[state=active]:bg-amber-500 data-[state=active]:text-white data-[state=active]:shadow-sm"
          >
            <Clock className="h-4 w-4 me-1.5 inline-block" />
            ממתינות
            <span className="ms-1.5 rounded-full bg-muted px-2 py-0.5 text-xs font-bold leading-none text-muted-foreground data-[state=active]:bg-white/25 data-[state=active]:text-white">
              {counts.pending}
            </span>
          </TabsTrigger>
          <TabsTrigger
            value="issued"
            className="flex-1 h-11 px-4 rounded-lg text-sm font-semibold data-[state=active]:bg-emerald-500 data-[state=active]:text-white data-[state=active]:shadow-sm"
          >
            <FileCheck2 className="h-4 w-4 me-1.5 inline-block" />
            הוצאה
            <span className="ms-1.5 rounded-full bg-muted px-2 py-0.5 text-xs font-bold leading-none text-muted-foreground data-[state=active]:bg-white/25 data-[state=active]:text-white">
              {counts.issued}
            </span>
          </TabsTrigger>
          <TabsTrigger
            value="all"
            className="flex-1 h-11 px-4 rounded-lg text-sm font-semibold data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm"
          >
            הכל
            <span className="ms-1.5 rounded-full bg-muted px-2 py-0.5 text-xs font-bold leading-none text-muted-foreground data-[state=active]:bg-white/25 data-[state=active]:text-primary-foreground">
              {counts.total}
            </span>
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Search */}
      <div className="flex items-center gap-2 bg-card rounded-xl border border-border px-3 py-2.5 shadow-card">
        <div className="relative flex-1">
          <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/70 pointer-events-none" />
          <Input
            placeholder="חפש לפי מס׳ הזמנה / שם / טלפון / מס׳ חשבונית..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 text-xs border-border bg-muted ps-8"
          />
        </div>
      </div>

      {/* Table */}
      <DataTable
        columns={columns}
        data={filtered}
        isLoading={isLoading}
        emptyMessage={
          activeTab === 'pending'
            ? '🎉 אין כרגע חשבוניות שממתינות'
            : activeTab === 'issued'
              ? 'עוד לא הוצאת חשבוניות'
              : 'לא נמצאו הזמנות'
        }
        tableClassName="table-fixed min-w-[1320px]"
      />
    </div>
  );
}
