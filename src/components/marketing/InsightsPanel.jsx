import React from 'react';
import { Sparkles, TrendingUp, TrendingDown, PhoneMissed, AlertTriangle, Clock, Ban } from 'lucide-react';
import InfoTip from './InfoTip';

const TONE_CLS = {
  emerald: 'border-emerald-200 bg-emerald-50/70 text-emerald-900',
  red: 'border-red-200 bg-red-50/70 text-red-900',
  amber: 'border-amber-200 bg-amber-50/70 text-amber-900',
  blue: 'border-blue-200 bg-blue-50/70 text-blue-900',
  orange: 'border-orange-200 bg-orange-50/70 text-orange-900',
};

const TYPE_ICON = {
  scale_up: TrendingUp,
  scale_down: TrendingDown,
  cost_no_leads: Ban,
  handling_gap: PhoneMissed,
  rising: TrendingUp,
  falling: TrendingDown,
  slow_channel: Clock,
};

// "המלצות חכמות" — the output of computeInsights rendered as compact action
// cards. onCampaignClick jumps straight to that campaign in the campaigns tab.
export default function InsightsPanel({ insights = [], onCampaignClick }) {
  if (!insights.length) return null;
  return (
    <div>
      <h2 className="text-sm font-bold text-foreground mb-2 flex items-center gap-1.5">
        <Sparkles className="h-4 w-4 text-indigo-500" />
        המלצות חכמות
        <InfoTip title="איך נולדת המלצה">
          <p>המערכת סורקת כל קמפיין וערוץ בטווח ומסמנת מה שדורש החלטה: המרה חריגה לטובה (להעלות תקציב), החזר גרוע (להוריד), לידים שלא נענים (לשפר טיפול — לא לגעת בתקציב), עלות בלי לידים, ומגמות חדות מול התקופה הקודמת.</p>
          <p>קמפיין נשפט רק מ-8 לידים ומעלה, וקמפיין שהלידים שלו לא טופלו לעולם לא יקבל המלצת קיצוץ — קודם מתקנים את הטיפול.</p>
          <p>כל כרטיס מפרט את המספרים שהובילו אליו. לחיצה על כרטיס עם שם קמפיין קופצת אליו בטבלת הקמפיינים.</p>
        </InfoTip>
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
        {insights.map((ins) => {
          const Icon = TYPE_ICON[ins.type] || AlertTriangle;
          const clickable = ins.campaign && onCampaignClick;
          const Tag = clickable ? 'button' : 'div';
          return (
            <Tag
              key={ins.key}
              type={clickable ? 'button' : undefined}
              onClick={clickable ? () => onCampaignClick(ins.campaign) : undefined}
              className={`text-right rounded-xl border p-3 ${TONE_CLS[ins.tone] || TONE_CLS.amber} ${
                clickable ? 'transition-all hover:shadow-card-hover hover:-translate-y-0.5 cursor-pointer' : ''
              }`}
            >
              <div className="flex items-center gap-1.5 mb-1">
                <Icon className="h-3.5 w-3.5 flex-shrink-0" />
                <span className="text-xs font-bold">{ins.title}</span>
              </div>
              <p className="text-xs leading-relaxed">{ins.detail}</p>
              <p className="text-[11px] mt-1.5 font-semibold opacity-80">{ins.action}</p>
            </Tag>
          );
        })}
      </div>
    </div>
  );
}
