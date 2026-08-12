import React from 'react';
import { SelectItem } from '@/components/ui/select';
import UserAvatar from '@/components/shared/UserAvatar';

/**
 * One rep inside a <Select>. Carries the rep's assigned icon + colour so a
 * dropdown of ten names is scannable — you find the person by their mark
 * rather than by reading every line. Radix clones the item's content into the
 * trigger, so the chosen rep's icon shows there too.
 *
 * `rep` only needs enough to identify the person: an email, or a full_name
 * when that's all the caller has (a few screens list reps from aggregate rows).
 * `children` overrides the label for the callers that append something to the
 * name — "(מפעל)", the e-mail, a connection state.
 */
export default function RepSelectItem({ rep, value, children, ...props }) {
  return (
    <SelectItem value={value ?? rep?.email} {...props}>
      <span className="flex items-center gap-2 min-w-0">
        <UserAvatar user={rep} size="xs" />
        <span className="truncate">{children ?? rep?.full_name ?? rep?.email ?? ''}</span>
      </span>
    </SelectItem>
  );
}
