const PAGE_SIZE = 500;
const BATCH_DELAY_MS = 150; // delay between batches to avoid 429 rate-limit
const MAX_RETRIES = 3;

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithRetry(fn, retries = MAX_RETRIES) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const is429 = err?.status === 429 || err?.message?.includes('429');
      if (is429 && attempt < retries) {
        await delay(1000 * (attempt + 1)); // 1s, 2s, 3s backoff
        continue;
      }
      throw err;
    }
  }
}

/**
 * Paginated fetch for base44 entity.list() - fetches ALL records beyond the 5000 limit.
 * Includes rate-limit protection with retry + backoff.
 */
export async function fetchAllList(entity, sort = '-created_date', pageSize = PAGE_SIZE) {
  const all = [];
  let skip = 0;
  while (true) {
    const batch = await fetchWithRetry(() => entity.list(sort, pageSize, skip));
    all.push(...batch);
    if (batch.length < pageSize) break;
    skip += pageSize;
    await delay(BATCH_DELAY_MS);
  }
  return all;
}

/**
 * Paginated fetch for base44 entity.filter() - fetches ALL matching records beyond the 5000 limit.
 * Includes rate-limit protection with retry + backoff.
 */
export async function fetchAllFiltered(entity, query, sort = '-created_date', pageSize = PAGE_SIZE) {
  const all = [];
  let skip = 0;
  while (true) {
    const batch = await fetchWithRetry(() => entity.filter(query, sort, pageSize, skip));
    all.push(...batch);
    if (batch.length < pageSize) break;
    skip += pageSize;
    await delay(BATCH_DELAY_MS);
  }
  return all;
}
