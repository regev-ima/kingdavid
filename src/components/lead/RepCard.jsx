import React from 'react';
import { Button } from "@/components/ui/button";
import { MessageCircle, Phone, RefreshCw, UserMinus } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import UserAvatar from "@/components/shared/UserAvatar";
import { isSameRep } from '@/lib/repSlots';

// Radix needs a non-empty string per item, so "remove the assignment" travels
// as a sentinel value rather than as an empty option.
const REMOVE_VALUE = '__remove__';

/**
 * One rep slot: who holds it, how to reach them, and how to change it.
 *
 * `excludeEmails` keeps a person out of the picker — the secondary slot passes
 * the primary rep, so the pairing that locks a lead to one person (see
 * lib/repSlots) simply isn't offered. `onRemove` adds "הסר שיוך" to the same
 * menu: a slot filled by mistake used to be unclearable from here, which left
 * an admin with a wrong secondary rep and no way out.
 */
export default function RepCard({ rep, label, isEmpty, onAssign, onRemove, excludeEmails = [], salesReps, canEdit, isPending }) {
  const assignableReps = (salesReps || []).filter(
    (r) => !excludeEmails.some((email) => isSameRep(r?.email, email)),
  );
  const handleSelect = (value) => {
    if (value === REMOVE_VALUE) onRemove?.();
    else onAssign?.(value);
  };
  if (isEmpty || !rep) {
    return (
      <div className="p-3 rounded-lg border border-dashed border-border bg-muted/50">
        <p className="text-[11px] font-medium text-muted-foreground/70 uppercase tracking-wide mb-2">{label}</p>
        {canEdit && onAssign && assignableReps.length > 0 ? (
          <Select onValueChange={handleSelect} disabled={isPending}>
            <SelectTrigger className="h-9 text-sm border-dashed border-border bg-white hover:bg-muted/50">
              <SelectValue placeholder={isPending ? "משייך..." : "בחר נציג לשיוך"} />
            </SelectTrigger>
            <SelectContent>
              {assignableReps.map((r) => (
                <SelectItem key={r.id} value={r.email}>
                  {r.full_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
              <span className="text-muted-foreground/40 text-sm">?</span>
            </div>
            <p className="text-sm text-muted-foreground/70">לא משויך</p>
          </div>
        )}
      </div>
    );
  }

  const handleWhatsApp = (e) => {
    e.stopPropagation();
    const phone = (rep.phone || rep.email || '').replace(/[^0-9]/g, '');
    if (phone) {
      window.open(`https://wa.me/972${phone.startsWith('0') ? phone.slice(1) : phone}`, '_blank');
    }
  };

  const handleCall = (e) => {
    e.stopPropagation();
    if (rep.phone) {
      window.open(`tel:${rep.phone}`, '_self');
    }
  };

  return (
    <div className="p-3 rounded-lg border border-border bg-white hover:border-violet-200 hover:bg-violet-50/30 transition-all duration-150">
      <p className="text-[11px] font-medium text-muted-foreground/70 uppercase tracking-wide mb-2.5">{label}</p>
      <div className="flex items-center gap-3">
        <UserAvatar user={rep} size="md" className="ring-2 ring-white shadow-sm" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground truncate">{rep.full_name}</p>
          {rep.phone && (
            <p className="text-xs text-muted-foreground/70 mt-0.5 truncate" dir="ltr">{rep.phone}</p>
          )}
          {!rep.phone && rep.email && (
            <p className="text-xs text-muted-foreground/70 mt-0.5 truncate">{rep.email}</p>
          )}
        </div>
        <div className="flex gap-1">
          {rep.phone && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-full text-muted-foreground/70 hover:text-green-600 hover:bg-green-50"
              onClick={handleWhatsApp}
            >
              <MessageCircle className="h-4 w-4" />
            </Button>
          )}
          {rep.phone && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-full text-muted-foreground/70 hover:text-blue-600 hover:bg-blue-50"
              onClick={handleCall}
            >
              <Phone className="h-4 w-4" />
            </Button>
          )}
          {canEdit && (onAssign || onRemove) && (
            <Select onValueChange={handleSelect} disabled={isPending}>
              <SelectTrigger className="h-8 w-8 p-0 border-0 bg-transparent hover:bg-muted rounded-full [&>svg:last-child]:hidden">
                <RefreshCw className="h-3.5 w-3.5 text-muted-foreground/70" />
              </SelectTrigger>
              <SelectContent>
                {assignableReps.filter((r) => !isSameRep(r.email, rep?.email)).map((r) => (
                  <SelectItem key={r.id} value={r.email}>
                    {r.full_name}
                  </SelectItem>
                ))}
                {onRemove && (
                  <SelectItem value={REMOVE_VALUE} className="text-destructive focus:text-destructive">
                    <span className="inline-flex items-center gap-2">
                      <UserMinus className="h-3.5 w-3.5" />
                      הסר שיוך
                    </span>
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>
    </div>
  );
}
