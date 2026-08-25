import { SOURCE_CHANNELS } from '@/constants/sourceChannels';

// The recommendation engine behind "המלצות חכמות": plain threshold rules over
// the merged rows from marketingMath. Every rule states WHY in the detail so a
// manager can disagree with it — this is decision support, not automation.
//
// Guardrails the rules share:
//   • Nothing is judged under MIN_LEADS — small campaigns produce noise, not
//     conclusions.
//   • A campaign whose leads aren't being called (low contact rate) is never
//     told to cut budget: the fix is in the sales floor, not the ad account.

const MIN_LEADS = 8;
const CONTACT_RATE_FLOOR = 60; // %
const SLOW_RESPONSE_MINS = 120;

const channelLabel = (ch) => SOURCE_CHANNELS[ch]?.label || 'אחר';

const TYPE_META = {
  scale_up: { tone: 'emerald', title: 'שווה להעלות תקציב', order: 1 },
  scale_down: { tone: 'red', title: 'לשקול להוריד תקציב', order: 2 },
  cost_no_leads: { tone: 'red', title: 'עלות בלי לידים', order: 0 },
  handling_gap: { tone: 'amber', title: 'הבעיה בטיפול, לא בקמפיין', order: 3 },
  rising: { tone: 'blue', title: 'במגמת עלייה', order: 4 },
  falling: { tone: 'orange', title: 'במגמת ירידה', order: 5 },
  slow_channel: { tone: 'amber', title: 'זמן תגובה איטי', order: 6 },
};

export default function computeInsights({ totals, channels = [], campaigns = [] }) {
  const insights = [];
  const avgConv = totals?.conversion || 0;
  const push = (type, body) => insights.push({ type, ...TYPE_META[type], ...body });

  for (const c of campaigns) {
    if (c.costOnly && c.spend > 0) {
      push('cost_no_leads', {
        key: `cost_no_leads:${c.campaign}`,
        campaign: c.campaign, channel: c.channel,
        detail: `הוצאו ₪${Math.round(c.spend).toLocaleString()} על "${c.campaign}" ולא נרשם אף ליד בתקופה.`,
        action: 'לבדוק אם הקמפיין פעיל בכלל, או לעצור את ההוצאה.',
        weight: c.spend,
      });
      continue;
    }
    if (c.leads < MIN_LEADS) continue;

    if (c.contactedRate < CONTACT_RATE_FLOOR) {
      push('handling_gap', {
        key: `handling_gap:${c.campaign}`,
        campaign: c.campaign, channel: c.channel,
        detail: `רק ${c.contactedRate.toFixed(0)}% מ-${c.leads.toLocaleString()} הלידים של "${c.campaign}" טופלו. אי אפשר לשפוט את הקמפיין ככה.`,
        action: 'קודם לוודא שהלידים נענים, ורק אז להחליט על תקציב.',
        weight: c.leads * (CONTACT_RATE_FLOOR - c.contactedRate),
      });
      // Don't ALSO recommend cutting a campaign nobody answers.
      continue;
    }

    const roasOk = c.roas == null || c.roas >= 1.5;
    if (c.conversion >= Math.max(avgConv * 1.25, 1) && c.won >= 3 && roasOk) {
      const roasTxt = c.roas != null ? `, ROAS ${c.roas.toFixed(1)}` : '';
      push('scale_up', {
        key: `scale_up:${c.campaign}`,
        campaign: c.campaign, channel: c.channel,
        detail: `"${c.campaign}" (${channelLabel(c.channel)}) סוגר ${c.conversion.toFixed(1)}% מול ${avgConv.toFixed(1)}% ממוצע — ${c.won.toLocaleString()} עסקאות, ₪${Math.round(c.revenue).toLocaleString()} הכנסות${roasTxt}.`,
        action: 'המספרים מצדיקים הגדלת תקציב הדרגתית תוך מעקב על ה-CPL.',
        weight: c.revenue + c.won * 1000,
      });
      continue;
    }

    const badRoas = c.roas != null && c.roas < 0.8 && c.spend > 0;
    const badConv = avgConv > 0 && c.conversion <= avgConv * 0.4 && c.leads >= MIN_LEADS * 2;
    if (badRoas || badConv) {
      const reason = badRoas
        ? `כל שקל שהושקע החזיר ₪${c.roas.toFixed(2)} בלבד (הוצאה ₪${Math.round(c.spend).toLocaleString()}).`
        : `סגירה של ${c.conversion.toFixed(1)}% בלבד מול ${avgConv.toFixed(1)}% ממוצע, על ${c.leads.toLocaleString()} לידים מטופלים.`;
      push('scale_down', {
        key: `scale_down:${c.campaign}`,
        campaign: c.campaign, channel: c.channel,
        detail: `"${c.campaign}" (${channelLabel(c.channel)}): ${reason}`,
        action: 'לצמצם תקציב או לרענן קהל/קריאייטיב לפני שממשיכים להשקיע.',
        weight: (c.spend || 0) + c.leads * 10,
      });
      continue;
    }

    if (c.prev && c.prev.leads >= MIN_LEADS) {
      if (c.leadsDelta != null && c.leadsDelta >= 0.3) {
        push('rising', {
          key: `rising:${c.campaign}`,
          campaign: c.campaign, channel: c.channel,
          detail: `"${c.campaign}" קפץ מ-${c.prev.leads.toLocaleString()} ל-${c.leads.toLocaleString()} לידים (עלייה של ${Math.round(c.leadsDelta * 100)}%) מול התקופה הקודמת.`,
          action: 'לעקוב שההמרה נשמרת גם בקצב החדש.',
          weight: c.leads,
        });
      } else if (c.leadsDelta != null && c.leadsDelta <= -0.3) {
        push('falling', {
          key: `falling:${c.campaign}`,
          campaign: c.campaign, channel: c.channel,
          detail: `"${c.campaign}" ירד מ-${c.prev.leads.toLocaleString()} ל-${c.leads.toLocaleString()} לידים (ירידה של ${Math.abs(Math.round(c.leadsDelta * 100))}%) מול התקופה הקודמת.`,
          action: 'לבדוק שחיקת קהל, תקציב שנחתך או קריאייטיב שהתעייף.',
          weight: c.prev.leads,
        });
      }
    }
  }

  for (const ch of channels) {
    if (ch.leads >= 20 && ch.medianMins != null && ch.medianMins > SLOW_RESPONSE_MINS) {
      const hours = (ch.medianMins / 60).toFixed(1);
      push('slow_channel', {
        key: `slow_channel:${ch.channel}`,
        channel: ch.channel,
        detail: `ליד מ${channelLabel(ch.channel)} מחכה חציונית ${hours} שעות לשיחה ראשונה (${ch.leads.toLocaleString()} לידים).`,
        action: 'ליד שנענה מהר נסגר יותר — לתעדף את הערוץ הזה במוקד.',
        weight: ch.leads,
      });
    }
  }

  return insights
    .sort((a, b) => a.order - b.order || b.weight - a.weight)
    .slice(0, 10);
}
