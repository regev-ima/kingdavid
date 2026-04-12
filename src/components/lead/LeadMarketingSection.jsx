import React, { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { ChevronDown } from 'lucide-react';
import DetailField from '@/components/lead/DetailField';
import { leadMarketingFields } from '@/constants/leadMarketingFields';

export default function LeadMarketingSection({ data = {}, onChange, readOnly = false }) {
  const [showMore, setShowMore] = useState(false);

  if (readOnly) {
    const hasValue = (field) => {
      const v = data?.[field.key];
      return v !== undefined && v !== null && String(v).trim() !== '';
    };

    const mainFields = leadMarketingFields.filter(f => !f.numericId);
    const numericFields = leadMarketingFields.filter(f => f.numericId);
    const hasNumericData = numericFields.some(f => hasValue(f));

    const renderField = (field) => {
      if (!hasValue(field)) return null;
      const value = data[field.key];

      return (
        <div key={field.key} className={field.multiline ? 'sm:col-span-2' : ''}>
          <DetailField label={field.label}>
            {field.key === 'landing_page' ? (
              <a
                href={value}
                target="_blank"
                rel="noreferrer"
                className="text-sm font-medium text-primary underline break-all"
              >
                {value}
              </a>
            ) : (
              <p className="text-sm font-medium text-foreground whitespace-pre-wrap break-words">
                {value}
              </p>
            )}
          </DetailField>
        </div>
      );
    };

    return (
      <div className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          {mainFields.map(renderField)}
        </div>

        {hasNumericData && (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setShowMore(!showMore)}
            >
              <ChevronDown className={`h-3.5 w-3.5 me-1 transition-transform ${showMore ? 'rotate-180' : ''}`} />
              {showMore ? 'הסתר פרטים נוספים' : 'הצג פרטים נוספים'}
            </Button>
            {showMore && (
              <div className="grid sm:grid-cols-2 gap-4 pt-2 border-t border-border/50">
                {numericFields.map(renderField)}
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="grid sm:grid-cols-2 gap-4">
      {leadMarketingFields.map((field) => (
        <div key={field.key} className={field.multiline ? 'sm:col-span-2 space-y-1.5' : 'space-y-1.5'}>
          <Label className="text-xs text-muted-foreground">{field.label}</Label>
          {field.multiline ? (
            <Textarea
              value={data?.[field.key] || ''}
              onChange={(e) => onChange(field.key, e.target.value)}
              rows={3}
              placeholder={field.placeholder}
            />
          ) : (
            <Input
              value={data?.[field.key] || ''}
              onChange={(e) => onChange(field.key, e.target.value)}
              placeholder={field.placeholder}
              className="h-9"
            />
          )}
        </div>
      ))}
    </div>
  );
}
