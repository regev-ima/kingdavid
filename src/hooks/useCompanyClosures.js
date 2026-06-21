import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { startOfMonth, addMonths } from '@/lib/safe-date-fns';
import { normalizeClosures, evaluateDate } from '@/lib/companyClosures';
import { useIsraeliHolidays } from './useIsraeliHolidays';

/**
 * Reads the company-wide "closed days" policy singleton (company_closures row
 * id=1), the same DB-backed admin-settings pattern as quote_defaults.
 *
 * Falls back to DEFAULT_CLOSURES (שבת closed) when the row / table is missing,
 * so date pickers keep a sane baseline even before the migration runs.
 */
export function useCompanyClosures() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['company-closures'],
    queryFn: async () => {
      const rows = await base44.entities.CompanyClosures.list();
      return rows[0] || null;
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  // react-query keeps `data` referentially stable between renders, so this
  // memo only recomputes when the row actually changes — important because the
  // config object feeds useCallback deps in useClosureChecker.
  const config = useMemo(() => normalizeClosures(data), [data]);

  return { config, raw: data ?? null, isLoading, isError };
}

/**
 * Bundles the closures config with the holiday calendar and hands back an
 * `evaluate(date)` function the UI can use to disable closed days / cap
 * half-day hours. Holidays are fetched for a ~2-year window starting this
 * month, which covers all realistic task scheduling; further-out dates simply
 * fall back to weekly + custom rules.
 */
export function useClosureChecker() {
  const { config } = useCompanyClosures();

  const rangeStart = useMemo(() => startOfMonth(new Date()), []);
  const rangeEnd = useMemo(() => addMonths(rangeStart, 25), [rangeStart]);
  const holidaysByDate = useIsraeliHolidays(rangeStart, rangeEnd);

  const evaluate = useCallback(
    (date) => evaluateDate(date, config, holidaysByDate),
    [config, holidaysByDate],
  );

  return { config, holidaysByDate, evaluate };
}
