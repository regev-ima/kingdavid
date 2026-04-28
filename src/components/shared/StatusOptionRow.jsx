import React from 'react';
import { useStatusColors } from '@/hooks/useStatusColors';
import { getStatusColorPreset } from '@/constants/statusColors';

// Default tailwind dot classes per built-in status — kept tiny on purpose.
// We mirror the most common buckets from StatusBadge's statusConfig so a
// dropdown row has a sensible color even before any admin override. Anything
// not in this map falls back to slate.
const DEFAULT_DOTS = {
  new_lead: 'bg-blue-500',
  hot_lead: 'bg-red-500',
  followup_before_quote: 'bg-purple-500',
  followup_after_quote: 'bg-indigo-500',
  coming_to_branch: 'bg-cyan-500',
  no_answer_1: 'bg-amber-500',
  no_answer_2: 'bg-amber-500',
  no_answer_3: 'bg-orange-500',
  no_answer_4: 'bg-orange-500',
  no_answer_5: 'bg-red-500',
  no_answer_whatsapp_sent: 'bg-green-500',
  no_answer_calls: 'bg-orange-500',
  changed_direction: 'bg-blue-500',
  deal_closed: 'bg-emerald-500',
  not_interested_hangs_up: 'bg-red-500',
  heard_price_not_interested: 'bg-red-500',
};

export function getStatusDotClass(status, statusColors = {}) {
  const overridePreset = getStatusColorPreset(statusColors[status]);
  if (overridePreset) return overridePreset.dot;
  return DEFAULT_DOTS[status] || 'bg-slate-400';
}

export default function StatusOptionRow({ status, label }) {
  const { statusColors } = useStatusColors();
  const dotClass = getStatusDotClass(status, statusColors);
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`w-2 h-2 rounded-full ${dotClass} flex-shrink-0`} />
      <span>{label}</span>
    </span>
  );
}
