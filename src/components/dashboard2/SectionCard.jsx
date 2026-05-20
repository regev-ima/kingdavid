import React from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { ChevronLeft } from 'lucide-react';
import { createPageUrl } from '@/utils';

// Reusable section wrapper for the Overview tab. Title + icon stay on the
// right (RTL start) and the drill-down link sits on the left (RTL end);
// dir="rtl" is pinned to both the outer Card and the header's flex row
// because relying on inherited direction was rendering the row LTR
// underneath some shadcn Card / Radix Tabs contexts.
export default function SectionCard({
  title,
  icon: Icon,
  iconColor = 'text-primary',
  iconBg = 'bg-primary/10',
  drillToPage,
  drillQuery = {},
  drillLabel = 'כניסה לדשבורד',
  onDrillClick,
  children,
}) {
  const params = new URLSearchParams(drillQuery).toString();
  const drillUrl = drillToPage
    ? params
      ? `${createPageUrl(drillToPage)}?${params}`
      : createPageUrl(drillToPage)
    : null;

  const drillButtonClass = 'group inline-flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80 transition-colors flex-shrink-0';
  const drillContent = (
    <>
      <span>{drillLabel}</span>
      <ChevronLeft className="h-3.5 w-3.5 group-hover:-translate-x-0.5 transition-transform" />
    </>
  );

  return (
    <Card className="border-border shadow-card hover:shadow-card-hover transition-shadow" dir="rtl">
      <CardHeader className="pb-3 border-b border-border/50">
        <div className="flex items-center justify-between gap-2" dir="rtl">
          <div className="flex items-center gap-2 min-w-0">
            {Icon ? (
              <div className={`p-1.5 rounded-md ${iconBg} flex-shrink-0`}>
                <Icon className={`h-4 w-4 ${iconColor}`} />
              </div>
            ) : null}
            <h3 className="text-sm font-bold text-foreground truncate" title={title}>
              {title}
            </h3>
          </div>
          {onDrillClick ? (
            <button type="button" onClick={onDrillClick} className={drillButtonClass}>
              {drillContent}
            </button>
          ) : drillUrl ? (
            <Link to={drillUrl} className={drillButtonClass}>
              {drillContent}
            </Link>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="p-3 space-y-3">{children}</CardContent>
    </Card>
  );
}
