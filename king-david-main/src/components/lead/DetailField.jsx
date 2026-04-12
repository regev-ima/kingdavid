import React from 'react';

export default function DetailField({ label, value, icon: Icon, children }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        {Icon && <Icon className="h-3 w-3 text-muted-foreground/70" />}
        <span className="text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wider">{label}</span>
      </div>
      {children || (
        <p className={`text-sm font-medium ${value && value !== '-' ? 'text-foreground' : 'text-muted-foreground/40'}`}>
          {value || '-'}
        </p>
      )}
    </div>
  );
}