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
// Security: card details are typed here only to be validated. The entry we hand
// back carries the last 4 digits + the cardholder name and NOTHING else — no
// PAN, no expiry, no CVV ever leaves this component or reaches the database.

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

// Group digits in fours while typing, so a 16-digit number stays readable.
const formatCardNumber = (raw) => (raw.replace(/\D/g, '').slice(0, 19).match(/.{1,4}/g) || []).join(' ');

// "1226" / "12/26" → "12/26". Typing is forward-only; the slash appears itself.
const formatExpiry = (raw) => {
  const digits = raw.replace(/\D/g, '').slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}/${digits.slice(2)}`;
};

function validateCard({ number, expiry, cvv, holder }) {
  const digits = (number || '').replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) return 'מספר כרטיס לא תקין (13–19 ספרות)';

  const m = /^(\d{2})\/(\d{2})$/.exec((expiry || '').trim());
  if (!m) return 'תוקף לא תקין — הזן בפורמט MM/YY';
  const month = parseInt(m[1], 10);
  const year = 2000 + parseInt(m[2], 10);
  if (month < 1 || month > 12) return 'חודש תוקף לא תקין';
  const now = new Date();
  // A card is valid through the LAST day of its expiry month.
  const expiresAfter = new Date(year, month, 1);
  if (expiresAfter <= now) return 'הכרטיס פג תוקף';

  if (!/^\d{3,4}$/.test((cvv || '').trim())) return 'CVV לא תקין (3–4 ספרות)';
  if (!(holder || '').trim()) return 'יש להזין שם בעל הכרטיס';
  return null;
}

export default function OrderPaymentDialog({
  open,
  onOpenChange,
  total = 0,
  alreadyPaid = 0,
  defaultMethod = 'credit_card',
  onConfirm,
  recordedBy,
  isSaving = false,
  title = 'רישום תשלום',
}) {
  const remaining = useMemo(() => Math.max(0, round2(total - alreadyPaid)), [total, alreadyPaid]);

  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState(defaultMethod);
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');
  const [card, setCard] = useState({ number: '', expiry: '', cvv: '', holder: '' });
  const [error, setError] = useState(null);

  // Re-arm on every open: default to the outstanding balance and the method the
  // caller asked for, and drop any card digits left over from a previous run.
  useEffect(() => {
    if (!open) return;
    setAmount(remaining > 0 ? String(remaining) : '');
    setMethod(defaultMethod || 'credit_card');
    setDate(new Date().toISOString().split('T')[0]);
    setNotes('');
    setCard({ number: '', expiry: '', cvv: '', holder: '' });
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
    if (isCard) {
      const cardError = validateCard(card);
      if (cardError) { setError(cardError); return; }
    }

    const digits = card.number.replace(/\D/g, '');
    onConfirm?.({
      amount: round2(numericAmount),
      method,
      date,
      notes: notes.trim(),
      recorded_at: new Date().toISOString(),
      recorded_by: recordedBy || null,
      // PCI: the last 4 digits and the name on the card are all we keep.
      ...(isCard ? { card_last4: digits.slice(-4), card_holder: card.holder.trim() } : {}),
    });
    // Wipe the card fields immediately — they must not survive the dialog.
    setCard({ number: '', expiry: '', cvv: '', holder: '' });
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
            <div className="rounded-lg border border-border p-3 space-y-3">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <ShieldCheck className="h-3.5 w-3.5 flex-shrink-0" />
                נשמרות רק 4 הספרות האחרונות ושם בעל הכרטיס.
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">מספר כרטיס</Label>
                <Input
                  value={card.number}
                  onChange={(e) => setCard((c) => ({ ...c, number: formatCardNumber(e.target.value) }))}
                  placeholder="0000 0000 0000 0000"
                  inputMode="numeric"
                  autoComplete="off"
                  dir="ltr"
                  className="h-9 text-left"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">תוקף</Label>
                  <Input
                    value={card.expiry}
                    onChange={(e) => setCard((c) => ({ ...c, expiry: formatExpiry(e.target.value) }))}
                    placeholder="MM/YY"
                    inputMode="numeric"
                    autoComplete="off"
                    dir="ltr"
                    className="h-9 text-left"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">CVV</Label>
                  <Input
                    value={card.cvv}
                    onChange={(e) => setCard((c) => ({ ...c, cvv: e.target.value.replace(/\D/g, '').slice(0, 4) }))}
                    placeholder="000"
                    inputMode="numeric"
                    autoComplete="off"
                    dir="ltr"
                    className="h-9 text-left"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">שם בעל הכרטיס</Label>
                <Input
                  value={card.holder}
                  onChange={(e) => setCard((c) => ({ ...c, holder: e.target.value }))}
                  placeholder="שם מלא"
                  autoComplete="off"
                  className="h-9"
                />
              </div>
            </div>
          )}

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
