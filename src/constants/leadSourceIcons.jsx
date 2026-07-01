import React from 'react';
import { Globe, Store, Headset, Phone, Users, Megaphone, Mail, MessageSquare, Radio } from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────
// Lead-source icon library.
//
// Every lead carries a free-text `source` string ("Facebook Form",
// "google_ads", "Outbrain", "TikTok", …). Instead of printing that raw text
// in the leads table and the lead screen, we render a recognisable icon so a
// rep can identify the channel at a glance.
//
// Two layers:
//   1. Automatic matching (matchSourceIconId) — recognises the common brands
//      by keyword, so the right logo shows for everyone with zero config.
//   2. Per-source overrides (managed in Settings → מקורות הגעה, persisted in
//      localStorage) — let an admin assign any icon from this library to a
//      specific source string, or fall back to a neutral default.
// ─────────────────────────────────────────────────────────────────────────

// Brand glyph from a single SVG path, painted in the brand colour.
function brandGlyph(path, color) {
  const Glyph = ({ className = 'h-4 w-4' }) => (
    <svg viewBox="0 0 24 24" className={className} fill={color} aria-hidden="true">
      <path d={path} />
    </svg>
  );
  return Glyph;
}

// A rounded monogram tile — used for brands we don't ship a vetted logo path
// for (Outbrain, Taboola) and for any custom source an admin wants to badge.
function monogramGlyph(letter, bg) {
  const Glyph = ({ className = 'h-4 w-4' }) => (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <rect width="24" height="24" rx="5" fill={bg} />
      <text x="12" y="17" textAnchor="middle" fontSize="14" fontWeight="700" fill="#ffffff" fontFamily="Heebo, sans-serif">{letter}</text>
    </svg>
  );
  return Glyph;
}

// A lucide icon tinted with a Tailwind text-color class (uses currentColor).
function lucideGlyph(Icon, colorClass) {
  const Glyph = ({ className = 'h-4 w-4' }) => <Icon className={`${className} ${colorClass}`} />;
  return Glyph;
}

// The official multicolour Google "G".
const GoogleGlyph = ({ className = 'h-4 w-4' }) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
    <path fill="#FBBC05" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.84z" />
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" />
  </svg>
);

const FACEBOOK_PATH = 'M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z';
const INSTAGRAM_PATH = 'M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z';
const TIKTOK_PATH = 'M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.08-.14 1.62.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z';
const YOUTUBE_PATH = 'M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z';
const WHATSAPP_PATH = 'M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.885-9.885 9.885M20.52 3.449C18.24 1.245 15.24 0 12.045 0 5.463 0 .104 5.359.101 11.892c0 2.096.549 4.142 1.595 5.945L0 24l6.335-1.652a11.882 11.882 0 005.71 1.454h.005c6.582 0 11.94-5.359 11.944-11.893a11.821 11.821 0 00-3.484-8.47';

// Order matters: matchSourceIconId returns the FIRST entry whose keyword is a
// substring of the (lower-cased) source, so brands come before generic terms.
export const SOURCE_ICON_LIBRARY = [
  { id: 'facebook',   label: 'Facebook',   keywords: ['facebook', 'fb'],                                Glyph: brandGlyph(FACEBOOK_PATH, '#1877F2') },
  { id: 'instagram',  label: 'Instagram',  keywords: ['instagram'],                                     Glyph: brandGlyph(INSTAGRAM_PATH, '#E4405F') },
  { id: 'google',     label: 'Google',     keywords: ['google', 'adwords', 'gads'],                     Glyph: GoogleGlyph },
  { id: 'tiktok',     label: 'TikTok',     keywords: ['tiktok', 'tik tok'],                             Glyph: brandGlyph(TIKTOK_PATH, '#111827') },
  { id: 'youtube',    label: 'YouTube',    keywords: ['youtube'],                                       Glyph: brandGlyph(YOUTUBE_PATH, '#FF0000') },
  { id: 'outbrain',   label: 'Outbrain',   keywords: ['outbrain'],                                      Glyph: monogramGlyph('O', '#EE6C21') },
  { id: 'taboola',    label: 'Taboola',    keywords: ['taboola'],                                       Glyph: monogramGlyph('T', '#0A7B83') },
  { id: 'whatsapp',   label: 'WhatsApp',   keywords: ['whatsapp', 'ווטסאפ', 'וואטסאפ'],                 Glyph: brandGlyph(WHATSAPP_PATH, '#25D366') },
  { id: 'website',    label: 'אתר',        keywords: ['website', 'web', 'site', 'אתר', 'organic'],       Glyph: lucideGlyph(Globe, 'text-sky-600') },
  { id: 'store',      label: 'חנות',       keywords: ['store', 'חנות', 'branch', 'סניף', 'walk'],        Glyph: lucideGlyph(Store, 'text-amber-600') },
  { id: 'callcenter', label: 'מוקד',       keywords: ['callcenter', 'call center', 'call-center', 'מוקד'], Glyph: lucideGlyph(Headset, 'text-violet-600') },
  { id: 'referral',   label: 'הפניה',      keywords: ['referral', 'הפניה', 'referrer', 'friend', 'חבר'], Glyph: lucideGlyph(Users, 'text-emerald-600') },
  { id: 'email',      label: 'אימייל',     keywords: ['email', 'mail', 'אימייל', 'מייל', 'newsletter', 'דיוור'], Glyph: lucideGlyph(Mail, 'text-rose-600') },
  { id: 'sms',        label: 'SMS',        keywords: ['sms', 'סמס'],                                     Glyph: lucideGlyph(MessageSquare, 'text-teal-600') },
  { id: 'phone',      label: 'טלפון',      keywords: ['phone', 'טלפון', 'call', 'שיחה', 'tel'],          Glyph: lucideGlyph(Phone, 'text-blue-600') },
  { id: 'digital',    label: 'דיגיטל',     keywords: ['digital', 'דיגיטל', 'campaign', 'ppc', 'מודעה'],  Glyph: lucideGlyph(Megaphone, 'text-indigo-600') },
  { id: 'default',    label: 'ברירת מחדל', keywords: [],                                                Glyph: lucideGlyph(Radio, 'text-muted-foreground') },
];

export const SOURCE_ICON_MAP = Object.fromEntries(SOURCE_ICON_LIBRARY.map((e) => [e.id, e]));
export const DEFAULT_SOURCE_ICON_ID = 'default';

// Icons an admin can pick from in Settings (everything except the neutral
// default, which is offered separately as "אוטומטי / ברירת מחדל").
export const SELECTABLE_SOURCE_ICONS = SOURCE_ICON_LIBRARY.filter((e) => e.id !== 'default');

// Recognise a source string → icon id by keyword. Falls back to 'default'.
export function matchSourceIconId(source) {
  if (!source) return DEFAULT_SOURCE_ICON_ID;
  const s = String(source).toLowerCase();
  for (const entry of SOURCE_ICON_LIBRARY) {
    if (entry.keywords.some((k) => s.includes(k))) return entry.id;
  }
  return DEFAULT_SOURCE_ICON_ID;
}

// Render a glyph by icon id (presentational; no overrides/matching logic).
export function SourceIconGlyph({ iconId, className = 'h-4 w-4' }) {
  const entry = SOURCE_ICON_MAP[iconId] || SOURCE_ICON_MAP[DEFAULT_SOURCE_ICON_ID];
  const Glyph = entry.Glyph;
  return <Glyph className={className} />;
}
