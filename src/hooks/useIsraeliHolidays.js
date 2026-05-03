import { useQuery } from '@tanstack/react-query';
import { format } from '@/lib/safe-date-fns';

// Pulls Israeli holidays from the public Hebcal API. Free, no auth, ships
// the canonical date list (the project doesn't have to ship a yearly-
// updated lookup table). Cached for 24h via react-query — for a calendar
// board we'd rather hit the API once per session than over and over.
//
// Returns a `holidaysByDate` map keyed by 'yyyy-MM-dd'. Each value is an
// array of { title, hebrew, category, isYomTov } so the renderer can pick
// what to surface.
//
// Query params: maj=major, min=minor, mod=modern, nx=rosh-chodesh skipped,
// i=on means Israeli observance (one day on yom tov instead of two), s=on
// includes erev-* entries so שישי-ערב-פסח shows up.
export function useIsraeliHolidays(startDate, endDate) {
  const startKey = startDate ? format(startDate, 'yyyy-MM-dd') : null;
  const endKey = endDate ? format(endDate, 'yyyy-MM-dd') : null;

  const { data: holidaysByDate = {} } = useQuery({
    queryKey: ['hebcal-holidays', startKey, endKey],
    enabled: !!startKey && !!endKey,
    staleTime: 24 * 60 * 60 * 1000,
    queryFn: async () => {
      const url = `https://www.hebcal.com/hebcal?cfg=json&v=1&maj=on&min=on&mod=on&nx=off&i=on&s=on&start=${startKey}&end=${endKey}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to fetch holidays');
      const json = await res.json();
      const map = {};
      for (const item of json.items || []) {
        if (item.category === 'parashat' || item.category === 'candles' || item.category === 'havdalah' || item.category === 'zmanim') {
          continue;
        }
        const dateKey = (item.date || '').slice(0, 10);
        if (!dateKey) continue;
        const isYomTov = item.yomtov === true || /חג /.test(item.hebrew || '') || item.category === 'holiday';
        (map[dateKey] = map[dateKey] || []).push({
          title: item.title,
          hebrew: item.hebrew,
          category: item.category,
          isYomTov,
        });
      }
      return map;
    },
  });

  return holidaysByDate;
}
