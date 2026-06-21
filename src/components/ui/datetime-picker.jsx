import React, { useEffect, useState } from 'react';
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Calendar } from "@/components/ui/calendar";
import { ChevronUp, ChevronDown, Calendar as CalendarIcon, Clock } from "lucide-react";
import { format } from "@/lib/safe-date-fns";
import { he } from "date-fns/locale";
import { useClosureChecker } from "@/hooks/useCompanyClosures";
import { parseTimeToMinutes } from "@/lib/companyClosures";

// Auto-commits internal state to the parent on every change so the value
// is always live — closing the dialog by clicking outside, hitting Esc,
// or pressing the close button never silently drops the user's pick.
// Earlier behaviour required pressing an explicit "Select" button before
// onChange fired, which produced "saved my date but it didn't update"
// surprises when the user closed the dialog any other way.
export function DateTimePicker({ value, onChange, placeholder = "בחר תאריך ושעה" }) {
  const [isOpen, setIsOpen] = useState(false);
  const { evaluate } = useClosureChecker();

  // Sensible default: if no value (or a past value), point at the next
  // upcoming hour today instead of dragging a stale month forward.
  const computeDefaultDate = () => {
    if (!value) {
      const d = new Date();
      d.setMinutes(0, 0, 0);
      d.setHours(d.getHours() + 1);
      return d;
    }
    return new Date(value);
  };

  const [selectedDate, setSelectedDate] = useState(computeDefaultDate);
  const [hours, setHours] = useState(() => computeDefaultDate().getHours());
  const [minutes, setMinutes] = useState(() => computeDefaultDate().getMinutes());

  // Keep internal state in sync when the parent provides a new value
  // (e.g. switching tasks).
  useEffect(() => {
    if (value) {
      const date = new Date(value);
      setSelectedDate(date);
      setHours(date.getHours());
      setMinutes(date.getMinutes());
    }
  }, [value]);

  const commit = (date, h, m) => {
    const next = new Date(date);
    next.setHours(h, m, 0, 0);
    onChange(next.toISOString());
  };

  const setDate = (d) => {
    if (!d) return;
    setSelectedDate(d);
    commit(d, hours, minutes);
  };
  const setHoursAndCommit = (h) => {
    setHours(h);
    commit(selectedDate, h, minutes);
  };
  const setMinutesAndCommit = (m) => {
    setMinutes(m);
    commit(selectedDate, hours, m);
  };

  const incrementHours = () => setHoursAndCommit((hours + 1) % 24);
  const decrementHours = () => setHoursAndCommit((hours - 1 + 24) % 24);
  const incrementMinutes = () => setMinutesAndCommit((minutes + 1) % 60);
  const decrementMinutes = () => setMinutesAndCommit((minutes - 1 + 60) % 60);

  // Company closure verdict for the currently-selected day, so the picker can
  // block closed days outright and warn when a half-day's cutoff is crossed.
  const selEval = evaluate(selectedDate);
  const cutoffMin = selEval.status === 'half_day' && selEval.until ? parseTimeToMinutes(selEval.until) : null;
  const timePastCutoff = cutoffMin != null && hours * 60 + minutes >= cutoffMin;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="w-full justify-start text-right font-normal"
        onClick={() => setIsOpen(true)}
      >
        <CalendarIcon className="ml-2 h-4 w-4 text-muted-foreground" />
        {value ? format(new Date(value), 'dd.MM.yyyy, HH:mm', { locale: he }) : placeholder}
      </Button>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-[580px] bg-white" dir="rtl">
          <div className="border-b border-border pb-3 mb-4">
            <h2 className="text-center text-lg font-semibold text-foreground">
              בחירת תאריך ושעה
            </h2>
          </div>

          <div className="flex gap-6" dir="ltr">
            {/* Time Picker */}
            <div className="flex flex-col items-center justify-between py-2 px-4 min-w-[180px]">
              <div className="text-sm text-muted-foreground mb-4 text-center">
                {format(selectedDate, 'dd.MM.yyyy')} {String(hours).padStart(2, '0')}:{String(minutes).padStart(2, '0')}
              </div>

              <div className="flex items-center gap-3 mb-6">
                {/* Hours */}
                <div className="flex flex-col items-center">
                  <button
                    type="button"
                    onClick={incrementHours}
                    className="p-1.5 hover:bg-muted rounded transition-colors"
                  >
                    <ChevronUp className="h-5 w-5 text-muted-foreground" />
                  </button>
                  <div className="text-5xl font-light my-1 min-w-[70px] text-center text-foreground">
                    {String(hours).padStart(2, '0')}
                  </div>
                  <button
                    type="button"
                    onClick={decrementHours}
                    className="p-1.5 hover:bg-muted rounded transition-colors"
                  >
                    <ChevronDown className="h-5 w-5 text-muted-foreground" />
                  </button>
                </div>

                <div className="text-4xl font-light text-muted-foreground">:</div>

                {/* Minutes */}
                <div className="flex flex-col items-center">
                  <button
                    type="button"
                    onClick={incrementMinutes}
                    className="p-1.5 hover:bg-muted rounded transition-colors"
                  >
                    <ChevronUp className="h-5 w-5 text-muted-foreground" />
                  </button>
                  <div className="text-5xl font-light my-1 min-w-[70px] text-center text-foreground">
                    {String(minutes).padStart(2, '0')}
                  </div>
                  <button
                    type="button"
                    onClick={decrementMinutes}
                    className="p-1.5 hover:bg-muted rounded transition-colors"
                  >
                    <ChevronDown className="h-5 w-5 text-muted-foreground" />
                  </button>
                </div>
              </div>

              {/* Half-day notice for the selected day (ערב חג / חצי-יום סגירה) */}
              {selEval.status === 'half_day' && (
                <div className={`mb-3 w-full rounded-lg border px-3 py-2 text-xs text-center ${
                  timePastCutoff ? 'border-red-300 bg-red-50 text-red-700' : 'border-amber-300 bg-amber-50 text-amber-700'
                }`} dir="rtl">
                  <div className="flex items-center justify-center gap-1.5 font-semibold">
                    <Clock className="h-3.5 w-3.5" />
                    {selEval.label || 'חצי יום'} — פתוח עד {selEval.until}
                  </div>
                  {timePastCutoff && <div className="mt-1">השעה שנבחרה היא לאחר שעת הסגירה</div>}
                </div>
              )}

              <Button type="button" onClick={() => setIsOpen(false)} className="px-10 py-2">
                סיום
              </Button>
            </div>

            {/* Divider */}
            <div className="w-px bg-border"></div>

            {/* Calendar */}
            <div className="flex-1 pr-2">
              <Calendar
                mode="single"
                selected={selectedDate}
                onSelect={setDate}
                disabled={(date) => evaluate(date).status === 'closed'}
                modifiers={{
                  halfDay: (date) => evaluate(date).status === 'half_day',
                  closedDay: (date) => evaluate(date).status === 'closed',
                }}
                modifiersClassNames={{
                  halfDay: 'text-amber-600 font-semibold underline decoration-dotted underline-offset-2',
                  closedDay: 'text-red-400 line-through',
                }}
                initialFocus
                className="rounded-lg border-0"
              />
              <div className="mt-2 space-y-1 text-[11px] text-muted-foreground" dir="rtl">
                <p className="flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-400" />
                  ימי חג / שבת / סגירה — חסומים לבחירה
                </p>
                <p className="flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-400" />
                  ערב חג / חצי יום — פתוח עד שעת הסגירה
                </p>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
