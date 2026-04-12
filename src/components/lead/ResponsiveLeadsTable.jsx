import React from 'react';
import { formatInTimeZone } from 'date-fns-tz';
import { AlertCircle, Phone } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import DataTable from '@/components/shared/DataTable';
import StatusBadge from '@/components/shared/StatusBadge';
import QuickActions from '@/components/shared/QuickActions';
import UserAvatar from '@/components/shared/UserAvatar';
import { SOURCE_LABELS, SLA_THRESHOLDS } from '@/constants/leadOptions';

function formatPhone(phone) {
  if (!phone) return '';
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length === 10) {
    return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
  }
  return phone;
}

function getTreatmentText(row) {
  if (!row.first_action_at) return 'טרם טופל';
  const created = new Date(row.created_date);
  const handled = new Date(row.first_action_at);
  const diffMinutes = Math.floor((handled - created) / 1000 / 60);

  if (diffMinutes < 60) return `${diffMinutes} דק'`;
  if (diffMinutes < 1440) return `${Math.floor(diffMinutes / 60)} שע'`;
  return `${Math.floor(diffMinutes / 1440)} ימים`;
}

function getSlaData(row) {
  if (!row.created_date || row.first_action_at) {
    return { label: 'טופל', className: 'text-muted-foreground/70' };
  }

  const now = new Date();
  const created = new Date(row.created_date + (row.created_date.includes('Z') ? '' : 'Z'));
  const diffMinutes = Math.floor((now - created) / 1000 / 60);

  let className = 'text-green-600';
  if (diffMinutes > SLA_THRESHOLDS.AMBER_MAX_MINUTES) className = 'text-red-600';
  else if (diffMinutes > SLA_THRESHOLDS.GREEN_MAX_MINUTES) className = 'text-amber-600';

  if (diffMinutes < 60) {
    return { label: diffMinutes === 1 ? 'דקה אחת' : `${diffMinutes} דקות`, className };
  }

  if (diffMinutes < 1440) {
    const hours = Math.floor(diffMinutes / 60);
    const mins = diffMinutes % 60;
    const hoursText = hours === 1 ? 'שעה אחת' : `${hours} שעות`;
    if (mins === 0) return { label: hoursText, className };
    const minsText = mins === 1 ? 'דקה' : `${mins} דקות`;
    return { label: `${hoursText} ו-${minsText}`, className };
  }

  const days = Math.floor(diffMinutes / 1440);
  const hours = Math.floor((diffMinutes % 1440) / 60);
  const daysText = days === 1 ? 'יום אחד' : `${days} ימים`;
  if (hours === 0) return { label: daysText, className };
  const hoursText = hours === 1 ? 'שעה' : `${hours} שעות`;
  return { label: `${daysText} ו-${hoursText}`, className };
}

function getRepDisplay(row, users) {
  if (!row.rep1 && row.pending_rep_email) {
    return { pending: true, text: `ממתין: ${row.pending_rep_email}` };
  }

  if (!row.rep1 || row.rep1 === '') {
    return { pending: true, text: 'לא משויך' };
  }

  const rep = users.find((u) => u.email === row.rep1);
  return rep || { email: row.rep1, full_name: row.rep1.split('@')[0] };
}

function MobileLeadCard({ row, users, selectedIds, onToggleSelect, onOpenLead, onClickToCall }) {
  const isSelected = selectedIds.includes(row.id);
  const isSelectionMode = selectedIds.length > 0;
  const sla = getSlaData(row);
  const rep = getRepDisplay(row, users);
  const dateStr = row.created_date
    ? row.created_date.includes('Z')
      ? row.created_date
      : `${row.created_date}Z`
    : new Date().toISOString();

  const handleCardClick = () => {
    if (isSelectionMode) {
      onToggleSelect(row, !isSelected);
      return;
    }
    onOpenLead(row);
  };

  return (
    <div
      onClick={handleCardClick}
      className={`rounded-2xl border bg-card p-4 shadow-card active:scale-[0.99] transition-all ${isSelected ? 'border-primary bg-primary/5' : 'border-border'}`}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleCardClick();
        }
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-2">
            <StatusBadge status={row.status} />
            {row.unique_id ? <span className="text-xs text-muted-foreground">ID: {row.unique_id}</span> : null}
          </div>
          <h3 className="text-base font-semibold text-foreground truncate">{row.full_name}</h3>
          <div className="mt-1 flex items-center gap-2">
            <span className="text-sm text-muted-foreground" dir="ltr">{formatPhone(row.phone)}</span>
            {row.phone ? (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onClickToCall(row.phone, row.id);
                }}
                className="h-7 w-7 rounded-full bg-green-100 hover:bg-green-200 flex items-center justify-center transition-colors flex-shrink-0"
                title="התקשר"
              >
                <Phone className="h-4 w-4 text-green-700" />
              </button>
            ) : null}
          </div>
        </div>

        <div onClick={(e) => e.stopPropagation()}>
          <Checkbox
            checked={isSelected}
            onCheckedChange={(checked) => onToggleSelect(row, checked === true)}
          />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-xl bg-muted/40 p-3">
          <div className="text-xs text-muted-foreground mb-1">SLA</div>
          <div className={`font-semibold ${sla.className}`}>{sla.label}</div>
        </div>
        <div className="rounded-xl bg-muted/40 p-3">
          <div className="text-xs text-muted-foreground mb-1">שם מודעה</div>
          <div className="font-medium text-foreground/80 text-xs line-clamp-2">{row.facebook_ad_name || '-'}</div>
        </div>
        <div className="rounded-xl bg-muted/40 p-3">
          <div className="text-xs text-muted-foreground mb-1">מקור</div>
          <div className="font-medium text-foreground text-xs leading-5">
            {SOURCE_LABELS[row.source] || row.source || '-'}
            {row.utm_source ? <div className="text-muted-foreground">{row.utm_source}</div> : null}
          </div>
        </div>
        <div className="rounded-xl bg-muted/40 p-3">
          <div className="text-xs text-muted-foreground mb-1">תאריך</div>
          <div className="font-medium text-foreground/80">{formatInTimeZone(new Date(dateStr), 'Asia/Jerusalem', 'dd/MM/yyyy')}</div>
          <div className="text-xs text-muted-foreground">{formatInTimeZone(new Date(dateStr), 'Asia/Jerusalem', 'HH:mm')}</div>
        </div>
      </div>

      <div className="mt-3 rounded-xl border border-border/70 p-3">
        <div className="text-xs text-muted-foreground mb-2">נציג</div>
        {rep.pending ? (
          <span className="text-amber-600 flex items-center gap-1 text-sm">
            <AlertCircle className="h-4 w-4" />
            {rep.text}
          </span>
        ) : (
          <div className="flex items-center gap-2 min-w-0">
            <UserAvatar user={rep} size="sm" />
            <span className="text-sm font-medium truncate">{rep.full_name}</span>
          </div>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between gap-2" onClick={(e) => e.stopPropagation()}>
        <Button variant="outline" size="sm" onClick={() => onOpenLead(row)} className="flex-1">
          פתח ליד
        </Button>
        <QuickActions
          type="lead"
          data={row}
          hideContactButtons={true}
          onView={() => onOpenLead(row)}
        />
      </div>
    </div>
  );
}

function MobileLeadCardSkeleton() {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-card space-y-3">
      <Skeleton className="h-5 w-28" />
      <Skeleton className="h-6 w-40" />
      <div className="grid grid-cols-2 gap-3">
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-16 w-full rounded-xl" />
      </div>
      <Skeleton className="h-12 w-full rounded-xl" />
    </div>
  );
}

export default function ResponsiveLeadsTable({
  columns,
  data,
  isLoading,
  selectedIds,
  users,
  onToggleSelect,
  onOpenLead,
  onClickToCall,
}) {
  return (
    <>
      <div className="hidden md:block">
        <DataTable
          columns={columns}
          data={data}
          isLoading={isLoading}
          emptyMessage="לא נמצאו לידים"
          selectionMode={selectedIds.length > 0}
          onRowClick={onOpenLead}
          onRowSelect={(row) => onToggleSelect(row, !selectedIds.includes(row.id))}
          tableClassName="table-fixed min-w-[1120px]"
        />
      </div>

      <div className="md:hidden space-y-3">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, index) => <MobileLeadCardSkeleton key={index} />)
        ) : data.length === 0 ? (
          <div className="rounded-2xl border border-border bg-card p-8 text-center text-sm text-muted-foreground shadow-card">
            לא נמצאו לידים
          </div>
        ) : (
          data.map((row) => (
            <MobileLeadCard
              key={row.id}
              row={row}
              users={users}
              selectedIds={selectedIds}
              onToggleSelect={onToggleSelect}
              onOpenLead={onOpenLead}
              onClickToCall={onClickToCall}
            />
          ))
        )}
      </div>
    </>
  );
}