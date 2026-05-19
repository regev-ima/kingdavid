import React from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { ChevronLeft } from 'lucide-react';
import { createPageUrl } from '@/utils';

// Reusable section wrapper for the Overview tab. Renders a title row with an
// icon and a "כניסה לדשבורד" link to the detail page, then the section's
// custom content below (typically a MiniKPI grid + a mini chart).
export default function SectionCard({
  title,
  icon: Icon,
  iconColor = 'text-primary',
  iconBg = 'bg-primary/10',
  drillToPage,
  drillQuery = {},
  drillLabel = 'כניסה לדשבורד',
  children,
}) {
  const params = new URLSearchParams(drillQuery).toString();
  const drillUrl = drillToPage
    ? params
      ? `${createPageUrl(drillToPage)}?${params}`
      : createPageUrl(drillToPage)
    : null;

  return (
    <Card className="border-border shadow-card hover:shadow-card-hover transition-shadow">
      <CardHeader className="pb-3 border-b border-border/50">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {Icon ? (
              <div className={`p-1.5 rounded-md ${iconBg}`}>
                <Icon className={`h-4 w-4 ${iconColor}`} />
              </div>
            ) : null}
            <h3 className="text-sm font-bold text-foreground">{title}</h3>
          </div>
          {drillUrl ? (
            <Link
              to={drillUrl}
              className="group inline-flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
            >
              <span>{drillLabel}</span>
              <ChevronLeft className="h-3.5 w-3.5 group-hover:-translate-x-0.5 transition-transform" />
            </Link>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="p-3 space-y-3">{children}</CardContent>
    </Card>
  );
}
