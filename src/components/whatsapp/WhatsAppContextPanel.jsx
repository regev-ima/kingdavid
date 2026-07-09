import React from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import StatusBadge from '@/components/shared/StatusBadge';
import {
  Loader2, UserCheck, UserPlus, ExternalLink, Phone, LifeBuoy, FileText,
  ShoppingCart, Crown, ChevronLeft, CircleUserRound,
} from 'lucide-react';
import { normalizeIsraeliPhone } from '@/utils/phoneUtils';
import { isOpenTicket } from './useWhatsAppContext';

function localPhone(phone) {
  const norm = normalizeIsraeliPhone(phone);
  if (norm && norm.startsWith('972')) return '0' + norm.slice(3);
  return String(phone || '').replace(/\D/g, '');
}

function Section({ icon: Icon, title, count, children }) {
  if (!count) return null;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {title}
        <span className="bg-muted text-foreground/70 rounded-full px-1.5 text-[10px]">{count}</span>
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Row({ to, onClick, title, subtitle, badge }) {
  const inner = (
    <div className="flex items-center gap-2 rounded-lg border p-2 hover:bg-muted/40 transition-colors cursor-pointer">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate">{title}</p>
        {subtitle ? <p className="text-[11px] text-muted-foreground truncate">{subtitle}</p> : null}
      </div>
      {badge}
      <ChevronLeft className="h-4 w-4 text-muted-foreground shrink-0" />
    </div>
  );
  if (to) return <Link to={to}>{inner}</Link>;
  return <button type="button" onClick={onClick} className="w-full text-right">{inner}</button>;
}

// CRM context for a WhatsApp contact: is this an existing lead/customer, what
// quotes/orders/service-tickets they have, plus one-click actions (open lead,
// create lead, open a service ticket, call).
export default function WhatsAppContextPanel({ phone, name, context, isLoading, onOpenLead, onCreateTicket }) {
  const { leads = [], customers = [], orders = [], tickets = [], quotes = [] } = context || {};
  const hasMatch = leads.length || customers.length || orders.length || tickets.length || quotes.length;
  const primaryLead = leads[0] || null;
  const primaryCustomer = customers[0] || null;
  const displayName = primaryCustomer?.full_name || primaryLead?.full_name || name || 'איש קשר';
  const openTickets = tickets.filter(isOpenTicket);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-4 py-3 border-b bg-card shrink-0">
        <p className="font-semibold flex items-center gap-2"><CircleUserRound className="h-4 w-4" />פרטי לקוח</p>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
        {isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <>
            {/* Identity */}
            {hasMatch ? (
              <div className="rounded-lg border border-green-200 bg-green-50 p-3 space-y-1">
                <div className="flex items-center gap-2 text-green-800">
                  <UserCheck className="h-4 w-4" />
                  <span className="font-semibold text-sm">לקוח קיים במערכת</span>
                </div>
                <p className="text-sm font-medium text-green-900">{displayName}</p>
                <p className="text-xs text-green-700" dir="ltr">{localPhone(phone)}</p>
              </div>
            ) : (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2">
                <div className="flex items-center gap-2 text-amber-800">
                  <UserPlus className="h-4 w-4" />
                  <span className="font-semibold text-sm">לא נמצא במערכת</span>
                </div>
                <p className="text-xs text-amber-700">איש הקשר הזה לא משויך לליד או לקוח קיים.</p>
                <Button asChild size="sm" className="w-full gap-1">
                  <Link to={`${createPageUrl('NewLead')}?phone=${encodeURIComponent(localPhone(phone))}`}>
                    <UserPlus className="h-3.5 w-3.5" />צור ליד חדש
                  </Link>
                </Button>
              </div>
            )}

            {/* Actions */}
            <div className="grid grid-cols-2 gap-2">
              <Button onClick={onCreateTicket} size="sm" className="gap-1.5 col-span-2 bg-rose-600 hover:bg-rose-700">
                <LifeBuoy className="h-4 w-4" />צור פניית שירות
              </Button>
              {primaryLead && (
                <Button onClick={() => onOpenLead(primaryLead.id)} size="sm" variant="outline" className="gap-1.5">
                  <ExternalLink className="h-3.5 w-3.5" />פתח ליד
                </Button>
              )}
              <Button asChild size="sm" variant="outline" className="gap-1.5">
                <a href={`tel:${localPhone(phone)}`}><Phone className="h-3.5 w-3.5" />התקשר</a>
              </Button>
              {primaryCustomer && (
                <Button asChild size="sm" variant="outline" className="gap-1.5 col-span-2">
                  <Link to={`${createPageUrl('CustomerDetails')}?id=${primaryCustomer.id}`}>
                    <Crown className="h-3.5 w-3.5" />כרטיס לקוח
                  </Link>
                </Button>
              )}
            </div>

            {/* Leads */}
            <Section icon={CircleUserRound} title="לידים" count={leads.length}>
              {leads.map((l) => (
                <Row
                  key={l.id}
                  onClick={() => onOpenLead(l.id)}
                  title={l.full_name || 'ליד'}
                  subtitle={l.unique_id ? `#${l.unique_id}` : ''}
                  badge={l.status ? <StatusBadge status={l.status} /> : null}
                />
              ))}
            </Section>

            {/* Quotes */}
            <Section icon={FileText} title="הצעות מחיר" count={quotes.length}>
              {quotes.map((q) => (
                <Row
                  key={q.id}
                  to={`${createPageUrl('QuoteDetails')}?id=${q.id}`}
                  title={`הצעה #${q.quote_number || q.id?.slice(0, 6)}`}
                  subtitle={q.total != null ? `₪${Number(q.total).toLocaleString()}` : ''}
                  badge={q.status ? <Badge variant="secondary" className="text-[10px]">{q.status}</Badge> : null}
                />
              ))}
            </Section>

            {/* Orders */}
            <Section icon={ShoppingCart} title="הזמנות" count={orders.length}>
              {orders.map((o) => (
                <Row
                  key={o.id}
                  to={`${createPageUrl('OrderDetails')}?id=${o.id}`}
                  title={`הזמנה #${o.order_number || o.id?.slice(0, 6)}`}
                  subtitle={o.total_amount != null ? `₪${Number(o.total_amount).toLocaleString()}` : ''}
                  badge={o.status ? <Badge variant="secondary" className="text-[10px]">{o.status}</Badge> : null}
                />
              ))}
            </Section>

            {/* Service tickets */}
            <Section icon={LifeBuoy} title="פניות שירות" count={tickets.length}>
              {tickets.map((t) => {
                const open = isOpenTicket(t);
                return (
                  <Row
                    key={t.id}
                    to={`${createPageUrl('TicketDetails')}?id=${t.id}`}
                    title={`קריאה #${t.ticket_number || t.id?.slice(0, 6)}`}
                    subtitle={t.subject || ''}
                    badge={
                      <Badge className={`text-[10px] ${open ? 'bg-red-100 text-red-700' : 'bg-muted text-muted-foreground'}`}>
                        {open ? 'פתוחה' : (t.status || 'סגורה')}
                      </Badge>
                    }
                  />
                );
              })}
            </Section>

            {openTickets.length > 0 && (
              <p className="text-[11px] text-red-600 bg-red-50 rounded p-2">
                שים לב: ללקוח יש {openTickets.length} {openTickets.length === 1 ? 'פנייה פתוחה' : 'פניות פתוחות'}.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
