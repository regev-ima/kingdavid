import React, { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CreditCard, Loader2, ShieldCheck, Wallet } from 'lucide-react';

// One payment dialog for BOTH the new-order screen and an existing order, so
// recording a payment feels the same in either place (the two used to be a
// modal on one screen and an inline mini-form on the other).
//
// This dialog RECORDS a payment that already happened — cash in the shop, a
// bank transfer, a cheque, a charge put through the shop's terminal. It does
// not take money.
//
// It deliberately has no card-number / expiry / CVV fields. Charging a card
// goes through Hyp (HypPaymentDialog + the hyp-sign / hyp-verify Edge
// Functions), where the card is entered inside Hyp's own iframe and never
// touches our DOM. A card form here would collect real card data, carry the PCI
// exposure that the iframe exists to avoid — and charge nothing.

export const PAYMENT_METHODS = {
  cash: 'מזומן',
  credit_card: 'כרטיס אשראי',
  bank_transfer: 'העברה בנקאית',
  check: 'צ\'ק',
  bit: 'ביט',
  paybox: 'פייבוקס',
  other: 'אחר',
};

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const money = (n) => `₪${(Number(n) || 0).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Sum of an order's payments array. `amount_paid` is derived, never stored. */
export function sumPayments(payments) {
  return round2((payments || []).reduce((sum, p) => sum + (Number(p.amount) || 0), 0));
}

/** unpaid / deposit_paid / paid, from the payments total vs. the order total. */
export function calcPaymentStatus(payments, total) {
  const paid = sumPayments(payments);
  if (paid <= 0) return 'unpaid';
  // Tolerate agorot-level drift so a "full balance" click doesn't land on
  // deposit_paid because of a rounding remainder.
  if (paid >= round2(total) - 0.01) return 'paid';
  return 'deposit_paid';
}

export default function OrderPaymentDialog({
  open,
  onOpenChange,
  total = 0,
  alreadyPaid = 0,
  defaultMethod = 'cash',
  onConfirm,
  recordedBy,
  isSaving = false,
  title = 'רישום תשלום',
  // Optional escape hatch to real clearing. Screens that CAN charge a card
  // (i.e. the order already exists, so hyp-sign has an order_id) pass this and
  // get a "go to Hyp" button when the method is credit card.
  onStartCardClearing,
}) {
  const remaining = useMemo(() => Math.max(0, round2(total - alreadyPaid)), [total, alreadyPaid]);

  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState(defaultMethod);
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState(null);

  // Re-arm on every open: default to the outstanding balance and the method the
  // caller asked for.
  useEffect(() => {
    if (!open) return;
    setAmount(remaining > 0 ? String(remaining) : '');
    setMethod(defaultMethod || 'cash');
    setDate(new Date().toISOString().split('T')[0]);
    setNotes('');
    setError(null);
  }, [open, defaultMethod, remaining]);

  const isCard = method === 'credit_card';

  const submit = () => {
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setError('יש להזין סכום גדול מ-0');
      return;
    }
    if (remaining > 0 && numericAmount > remaining + 0.01) {
      setError(`הסכום חורג מהיתרה לתשלום (${money(remaining)})`);
      return;
    }

    onConfirm?.({
      amount: round2(numericAmount),
      method,
      date,
      notes: notes.trim(),
      recorded_at: new Date().toISOString(),
      recorded_by: recordedBy || null,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[92vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isCard ? <CreditCard className="h-5 w-5 text-primary" /> : <Wallet className="h-5 w-5 text-primary" />}
            {title}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="rounded-lg bg-muted/40 p-3 text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">סה״כ הזמנה</span>
              <span className="tabular-nums">{money(total)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">שולם עד כה</span>
              <span className="tabular-nums text-emerald-600">{money(alreadyPaid)}</span>
            </div>
            <div className="flex justify-between border-t pt-1 font-semibold">
              <span>יתרה לתשלום</span>
              <span className="tabular-nums">{money(remaining)}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">אמצעי תשלום</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(PAYMENT_METHODS).map(([key, label]) => (
                    <SelectItem key={key} value={key}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">תאריך</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-9" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">סכום</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              dir="ltr"
              className="h-9 text-left"
            />
            <div className="flex flex-wrap gap-2 pt-0.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                disabled={remaining <= 0}
                onClick={() => setAmount(String(remaining))}
              >
                יתרה מלאה ({money(remaining)})
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                disabled={remaining <= 0}
                onClick={() => setAmount(String(round2(remaining / 2)))}
              >
                מקדמה 50% ({money(round2(remaining / 2))})
              </Button>
            </div>
          </div>

          {isCard && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 flex items-start gap-2 text-xs text-amber-900">
              <ShieldCheck className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
              <span>
                כאן רק מתעדים חיוב אשראי שכבר בוצע (למשל במסוף בחנות).
                {onStartCardClearing ? ' לחיוב בפועל יש להשתמש בסליקת Hyp.' : ''}
                {' '}מומלץ לציין את מספר האישור בהערה.
              </span>
            </div>
          )}

          {isCard && onStartCardClearing ? (
            <Button
              type="button"
              variant="secondary"
              className="w-full"
              onClick={() => { onOpenChange(false); onStartCardClearing(); }}
            >
              <CreditCard className="h-4 w-4 me-1.5" />
              מעבר לסליקת Hyp
            </Button>
          ) : null}

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">הערה (אופציונלי)</Label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="מספר צ'ק, אסמכתא..."
              className="h-9"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
              ביטול
            </Button>
            <Button type="button" onClick={submit} disabled={isSaving}>
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin me-2" /> : null}
              שמור תשלום
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
