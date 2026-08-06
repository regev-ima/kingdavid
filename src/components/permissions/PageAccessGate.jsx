import React from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Button } from '@/components/ui/button';
import { ShieldOff } from 'lucide-react';
import { getPermission } from '@/lib/permissions';

/**
 * Shown instead of a page the user may not open.
 *
 * Deliberately says which area is blocked and who to ask, rather than
 * pretending the page does not exist. The person hitting this is a colleague
 * who followed a link, not an attacker — an unexplained 404 just generates a
 * support call. It leaks nothing: they already knew the area exists, since
 * they had a link to it.
 */
export default function PageAccessGate({ permissionKey, fallbackPage = 'Settings', currentPage }) {
  const node = getPermission(permissionKey);
  // When the only page we could offer is the one they are already refused,
  // showing a button back to it is a loop with a friendly label on it.
  const showWayOut = Boolean(fallbackPage) && fallbackPage !== currentPage;

  return (
    <div className="mx-auto flex max-w-lg flex-col items-center py-20 text-center">
      <span className="mb-5 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
        <ShieldOff className="h-7 w-7 text-muted-foreground" />
      </span>
      <h1 className="text-xl font-bold text-foreground">אין לך גישה לעמוד הזה</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        {node?.label ? (
          <>
            ההרשאה <span className="font-medium text-foreground">״{node.label}״</span> חסומה
            עבורך. אם אתה צריך אותה, פנה למנהל המערכת.
          </>
        ) : (
          <>ההרשאה לעמוד הזה חסומה עבורך. אם אתה צריך אותה, פנה למנהל המערכת.</>
        )}
      </p>
      {showWayOut ? (
        <Button asChild variant="outline" className="mt-6">
          <Link to={createPageUrl(fallbackPage)}>חזרה למסך הראשי</Link>
        </Button>
      ) : null}
    </div>
  );
}
