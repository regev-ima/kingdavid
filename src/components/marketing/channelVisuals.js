import { SOURCE_CHANNELS } from '@/constants/sourceChannels';

// Chart-side visuals for channels. SOURCE_CHANNELS carries Tailwind classes
// (badges, chips); recharts needs raw hex — and facebook/instagram share a
// Tailwind hue there, which is fine for a badge but unreadable as two bars in
// one stack, so instagram gets its own hue here.
export const CHANNEL_HEX = {
  google: '#ef4444',
  facebook: '#3b82f6',
  instagram: '#a855f7',
  tiktok: '#171717',
  whatsapp: '#22c55e',
  outbrain: '#f97316',
  telegram: '#0ea5e9',
  callcenter: '#8b5cf6',
  store: '#f59e0b',
  website: '#06b6d4',
  referral: '#14b8a6',
  service: '#64748b',
  unknown: '#94a3b8',
};

export const channelHex = (ch) => CHANNEL_HEX[ch] || CHANNEL_HEX.unknown;
export const channelLabel = (ch) => SOURCE_CHANNELS[ch]?.label || 'אחר';
