/**
 * Mirror of the operator-aware filter handling that
 * `src/api/entities.js` performs when calling Supabase from the
 * browser. The bulk-update Edge Functions used to interpret only
 * `Array → in()` and `else → eq()`, which silently turned any
 * operator-shaped filter (e.g. `{phone: {$regex: '…'}}` or `{$and: [...]}`)
 * into `eq('phone', '[object Object]')` and matched zero rows.
 *
 * Supported operators (must stay aligned with `entities.js`):
 *   $regex / $ilike   → ilike(k, '%v%')
 *   $eq               → eq
 *   $ne               → neq
 *   $gte / $lte / $gt / $lt
 *   $in / $nin
 *   value === null    → is(k, null)
 *   value === ''      → eq(k, '')
 *   array             → in(k, array)
 *   primitive         → eq(k, value)
 *   $or: [...]        → query.or('a.eq.x,b.eq.y')
 *   $and: [...]       → recurse into each condition
 */

// Build a single PostgREST-style "field.op.value" fragment for a one-pair
// condition like {full_name: 'רגב'} or {full_name: {$regex: 'רגב'}}.
function conditionPairToOrFragment(k: string, v: unknown): string {
  if (v === null) return `${k}.is.null`;
  if (v === '') return `${k}.eq.`;
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const obj = v as Record<string, unknown>;
    if (obj.$regex != null) return `${k}.ilike.*${obj.$regex}*`;
    if (obj.$ilike != null) return `${k}.ilike.*${obj.$ilike}*`;
    if (obj.$in != null && Array.isArray(obj.$in)) return `${k}.in.(${obj.$in.join(',')})`;
    if (obj.$gte != null) return `${k}.gte.${obj.$gte}`;
    if (obj.$lte != null) return `${k}.lte.${obj.$lte}`;
    if (obj.$gt != null) return `${k}.gt.${obj.$gt}`;
    if (obj.$lt != null) return `${k}.lt.${obj.$lt}`;
    if (obj.$ne != null) return `${k}.neq.${obj.$ne}`;
    if (obj.$eq != null) return `${k}.eq.${obj.$eq}`;
  }
  if (Array.isArray(v)) return `${k}.in.(${v.join(',')})`;
  return `${k}.eq.${v}`;
}

function applyValueOperators<TQuery extends { gte: any; lte: any; gt: any; lt: any; neq: any; not: any; in: any; ilike: any; eq: any; is: any }>(
  query: TQuery,
  key: string,
  value: unknown,
): TQuery {
  if (value === null) return query.is(key, null) as TQuery;
  if (value === '') return query.eq(key, '') as TQuery;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    let q: any = query;
    if (obj.$gte != null) q = q.gte(key, obj.$gte);
    if (obj.$lte != null) q = q.lte(key, obj.$lte);
    if (obj.$lt != null) q = q.lt(key, obj.$lt);
    if (obj.$gt != null) q = q.gt(key, obj.$gt);
    if (obj.$ne != null) q = q.neq(key, obj.$ne);
    if (obj.$nin != null && Array.isArray(obj.$nin)) q = q.not(key, 'in', `(${obj.$nin.join(',')})`);
    if (obj.$in != null && Array.isArray(obj.$in)) q = q.in(key, obj.$in);
    if (obj.$regex != null) q = q.ilike(key, `%${obj.$regex}%`);
    if (obj.$ilike != null) q = q.ilike(key, `%${obj.$ilike}%`);
    if (obj.$eq != null) q = q.eq(key, obj.$eq);
    return q;
  }
  if (Array.isArray(value)) return query.in(key, value as unknown[]) as TQuery;
  return query.eq(key, value as never) as TQuery;
}

export function applyBulkFilter<TQuery extends { or: any; gte: any; lte: any; gt: any; lt: any; neq: any; not: any; in: any; ilike: any; eq: any; is: any }>(
  query: TQuery,
  filter: Record<string, unknown> | null | undefined,
): TQuery {
  if (!filter || typeof filter !== 'object') return query;

  let q: any = query;
  for (const [key, value] of Object.entries(filter)) {
    if (key === '$or' && Array.isArray(value)) {
      const orParts = value
        .map((cond) => Object.entries(cond as Record<string, unknown>).map(([k, v]) => conditionPairToOrFragment(k, v)).join(','))
        .filter(Boolean);
      if (orParts.length) q = q.or(orParts.join(','));
      continue;
    }
    if (key === '$and' && Array.isArray(value)) {
      for (const cond of value) {
        if (!cond || typeof cond !== 'object') continue;
        for (const [k, v] of Object.entries(cond as Record<string, unknown>)) {
          if (k === '$or' && Array.isArray(v)) {
            const orParts = v
              .map((sub) => Object.entries(sub as Record<string, unknown>).map(([sk, sv]) => conditionPairToOrFragment(sk, sv)).join(','))
              .filter(Boolean);
            if (orParts.length) q = q.or(orParts.join(','));
          } else {
            q = applyValueOperators(q, k, v);
          }
        }
      }
      continue;
    }
    q = applyValueOperators(q, key, value);
  }
  return q as TQuery;
}
