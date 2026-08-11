// "This person already enquired before" — the repeat-enquiry marker.
//
// A person who enquires twice deliberately produces TWO lead rows (see the
// note in supabase/functions/upsertLead: the daily lead count is compared
// against what Facebook and Google report, where every form fill is one
// conversion). Being the same person is handled one layer down — a database
// trigger attaches every lead to a contact by normalized phone, so both rows
// carry the same `contact_id`.
//
// That leaves the rep with no way to tell, from a list, that the row in front
// of them is the third time this person has come in. This module answers that
// for a batch of leads in one query, and `RepeatEnquiryBadge` renders it.

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { parseDbTimestamp } from '@/lib/safe-date-fns-tz';

const EMPTY_MAP = new Map();

// Ordering key for "which enquiry came first".
//
// created_date, NOT effective_sort_date: the sort date gets bumped when a lead
// re-engages, which would make the ORIGINAL row look newer than the repeat and
// flip the labels. Ties (a bulk import stamps one created_date across the whole
// batch) fall back to the id, so the ordering is total and exactly one row per
// contact stays unmarked.
function compareEnquiries(a, b) {
  const da = parseDbTimestamp(a?.created_date)?.getTime() ?? Number.MAX_SAFE_INTEGER;
  const db = parseDbTimestamp(b?.created_date)?.getTime() ?? Number.MAX_SAFE_INTEGER;
  if (da !== db) return da - db;
  return String(a?.id || '').localeCompare(String(b?.id || ''));
}

/**
 * Map of leadId → `{ ordinal, total }` for every lead of a contact who appears
 * more than once. `ordinal` is which enquiry this row is (1 = the first one
 * that came in), `total` is how many that person has.
 *
 * EVERY row of a duplicated contact is in the map, including the first. The
 * marker used to skip it, on the reasoning that the original isn't a repeat —
 * true, and useless in a list. A rep scrolling past two rows of the same person
 * sees whichever one is in front of them, and if that happens to be the earlier
 * row it carried no warning at all: two identical-looking leads, one silently
 * flagged, one not. What the rep needs to know is "this person is in here more
 * than once", and that is true of every row involved.
 *
 * A contact with a single lead is absent — nothing to warn about.
 *
 * `rows` must be every lead of the contacts you care about — pass a partial
 * set and the counts are wrong.
 */
export function buildRepeatEnquiryMap(rows) {
  const byContact = new Map();
  for (const row of rows || []) {
    if (!row?.id || !row?.contact_id) continue;
    const list = byContact.get(row.contact_id);
    if (list) list.push(row);
    else byContact.set(row.contact_id, [row]);
  }

  const ordinals = new Map();
  for (const list of byContact.values()) {
    if (list.length < 2) continue;
    list.sort(compareEnquiries);
    list.forEach((row, index) => {
      ordinals.set(row.id, { ordinal: index + 1, total: list.length });
    });
  }
  return ordinals;
}

/**
 * Repeat-enquiry entries (`{ ordinal, total }`) for a page of leads, in one
 * batched query.
 * Returns an empty map while loading, for leads with no contact, and in an
 * environment where `contact_id` hasn't been migrated in yet — the badge is
 * an extra, and it must never take a lead list down with it.
 */
export function useRepeatEnquiries(leads) {
  const contactIds = useMemo(() => {
    const ids = new Set();
    for (const lead of leads || []) {
      if (lead?.contact_id) ids.add(lead.contact_id);
    }
    return [...ids].sort();
  }, [leads]);

  const { data: ordinals = EMPTY_MAP } = useQuery({
    queryKey: ['lead-repeat-enquiries', contactIds.join(',')],
    enabled: contactIds.length > 0,
    staleTime: 60_000,
    placeholderData: (previous) => previous,
    queryFn: async () => {
      try {
        const rows = await base44.entities.Lead.filter(
          { contact_id: { $in: contactIds } },
          'created_date',
          Math.max(500, contactIds.length * 10),
          undefined,
          'id, contact_id, created_date',
        );
        return buildRepeatEnquiryMap(rows);
      } catch (err) {
        console.warn('[repeatEnquiries] lookup failed, badge disabled:', err?.message || err);
        return EMPTY_MAP;
      }
    },
  });

  return ordinals;
}
