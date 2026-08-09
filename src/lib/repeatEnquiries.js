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
 * Map of leadId → ordinal (2 = second enquiry from this person, 3 = third …).
 * The first enquiry of each contact is absent from the map: it isn't a
 * "פנייה נוספת", it's the original.
 *
 * `rows` must be every lead of the contacts you care about — pass a partial
 * set and the ordinals are wrong.
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
      if (index > 0) ordinals.set(row.id, index + 1);
    });
  }
  return ordinals;
}

/**
 * Repeat-enquiry ordinals for a page of leads, in one batched query.
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
