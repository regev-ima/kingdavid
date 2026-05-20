import React from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ChevronLeft, Sparkles } from 'lucide-react';
import { createPageUrl } from '@/utils';

// Stub for tabs that haven't been fleshed out yet. Keeps the tab UI in place
// so the customer sees the full nav and provides a direct shortcut to the
// existing area page until we wire up the rich drilldown content.
export default function PlaceholderTab({ title, description, drillToPage, drillLabel }) {
  return (
    <Card className="border-border shadow-card">
      <CardContent className="p-8 text-center space-y-4">
        <div className="inline-flex p-3 rounded-full bg-primary/10">
          <Sparkles className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-foreground">{title}</h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">{description}</p>
        </div>
        {drillToPage ? (
          <Link to={createPageUrl(drillToPage)}>
            <Button variant="outline" className="gap-2">
              <span>{drillLabel || 'כניסה לדשבורד המלא'}</span>
              <ChevronLeft className="h-4 w-4" />
            </Button>
          </Link>
        ) : null}
      </CardContent>
    </Card>
  );
}
