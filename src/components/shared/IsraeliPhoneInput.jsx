import React, { useState } from 'react';
import { Input } from '@/components/ui/input';
import { isValidIsraeliPhone, sanitizePhoneInput } from '@/utils/phoneUtils';
import { cn } from '@/lib/utils';

// Wraps the standard Input with Israeli-phone sanitization (digits / + /
// dashes / spaces only) and inline validation. The error hint only shows
// after the user has touched and left the field — typing one digit
// shouldn't immediately scream "invalid".
export default function IsraeliPhoneInput({
  value,
  onChange,
  onBlur,
  className,
  errorClassName,
  showError = true,
  ...inputProps
}) {
  const [touched, setTouched] = useState(false);
  const isInvalid = touched && value && !isValidIsraeliPhone(value);

  const handleChange = (e) => {
    const next = sanitizePhoneInput(e.target.value);
    onChange?.(next, e);
  };

  const handleBlur = (e) => {
    setTouched(true);
    onBlur?.(e);
  };

  return (
    <div className="space-y-1">
      <Input
        {...inputProps}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        dir="ltr"
        value={value || ''}
        onChange={handleChange}
        onBlur={handleBlur}
        aria-invalid={isInvalid || undefined}
        className={cn(isInvalid && 'border-destructive focus-visible:ring-destructive', className)}
      />
      {showError && isInvalid && (
        <p className={cn('text-xs text-destructive', errorClassName)}>
          מספר טלפון לא תקין. פורמט ישראלי: 05X-XXXXXXX או 0X-XXXXXXX
        </p>
      )}
    </div>
  );
}
