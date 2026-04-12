import React, { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Calendar } from "@/components/ui/calendar";
import { ChevronUp, ChevronDown, Calendar as CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { he } from "date-fns/locale";

export function DateTimePicker({ value, onChange, placeholder = "בחר תאריך ושעה" }) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState(value ? new Date(value) : new Date());
  const [hours, setHours] = useState(value ? new Date(value).getHours() : 9);
  const [minutes, setMinutes] = useState(value ? new Date(value).getMinutes() : 0);

  useEffect(() => {
    if (value) {
      const date = new Date(value);
      setSelectedDate(date);
      setHours(date.getHours());
      setMinutes(date.getMinutes());
    }
  }, [value]);

  const handleSelect = () => {
    const newDate = new Date(selectedDate);
    newDate.setHours(hours);
    newDate.setMinutes(minutes);
    onChange(newDate.toISOString());
    setIsOpen(false);
  };

  const incrementHours = () => setHours((h) => (h + 1) % 24);
  const decrementHours = () => setHours((h) => (h - 1 + 24) % 24);
  const incrementMinutes = () => setMinutes((m) => (m + 1) % 60);
  const decrementMinutes = () => setMinutes((m) => (m - 1 + 60) % 60);

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
        <DialogContent className="max-w-[580px] bg-white" dir="ltr">
          <div className="border-b border-border pb-3 mb-4">
            <h2 className="text-center text-lg font-semibold text-foreground">
              Select Date and Time
            </h2>
          </div>

          <div className="flex gap-6">
            {/* Time Picker */}
            <div className="flex flex-col items-center justify-between py-2 px-4 min-w-[180px]">
              <div className="text-sm text-muted-foreground mb-4 text-center">
                {format(selectedDate, 'dd-MM-yyyy')} {String(hours).padStart(2, '0')}:{String(minutes).padStart(2, '0')}
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

              <Button
                type="button"
                onClick={handleSelect}
                className="px-10 py-2"
              >
                Select
              </Button>
            </div>

            {/* Divider */}
            <div className="w-px bg-border"></div>

            {/* Calendar */}
            <div className="flex-1 pr-2">
              <Calendar
                mode="single"
                selected={selectedDate}
                onSelect={(date) => date && setSelectedDate(date)}
                initialFocus
                className="rounded-lg border-0"
              />
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}