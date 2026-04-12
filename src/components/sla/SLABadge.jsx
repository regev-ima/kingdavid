import { useState, useEffect } from 'react';
import { Badge } from "@/components/ui/badge";
import { Clock, AlertTriangle, CheckCircle } from "lucide-react";

export default function SLABadge({ lead, showTimer = true }) {
  const [minutesSinceEntry, setMinutesSinceEntry] = useState(0);
  
  useEffect(() => {
    if (!lead.created_date || lead.first_action_at) return;

    const calculateMinutes = () => {
      // Convert UTC to proper Date object
      const entryTime = new Date(lead.created_date + (lead.created_date.includes('Z') ? '' : 'Z'));
      const now = new Date();
      const minutes = Math.floor((now - entryTime) / 60000);
      setMinutesSinceEntry(minutes);
    };

    calculateMinutes();
    const interval = setInterval(calculateMinutes, 30000); // Update every 30s

    return () => clearInterval(interval);
  }, [lead.created_date, lead.first_action_at]);

  // If already actioned
  if (lead.first_action_at) {
    return showTimer ? (
      <Badge className="bg-gray-100 text-gray-600">
        <CheckCircle className="h-3 w-3 me-1" />
        טופל
      </Badge>
    ) : null;
  }

  // Calculate SLA status
  let slaStatus = 'green';
  let icon = Clock;
  let colorClass = 'bg-green-100 text-green-700';

  if (minutesSinceEntry > 15) {
    slaStatus = 'red';
    icon = AlertTriangle;
    colorClass = 'bg-red-100 text-red-700 animate-pulse';
  } else if (minutesSinceEntry > 5) {
    slaStatus = 'yellow';
    icon = Clock;
    colorClass = 'bg-amber-100 text-amber-700';
  }

  const Icon = icon;

  if (!showTimer) {
    return <Badge className={colorClass}><Icon className="h-3 w-3" /></Badge>;
  }

  // Format time display in Hebrew
  let timeDisplay;
  if (minutesSinceEntry < 60) {
    timeDisplay = minutesSinceEntry === 1 ? 'דקה אחת' : `${minutesSinceEntry} דקות`;
  } else if (minutesSinceEntry < 1440) {
    const hours = Math.floor(minutesSinceEntry / 60);
    const mins = minutesSinceEntry % 60;
    const hoursText = hours === 1 ? 'שעה אחת' : `${hours} שעות`;
    if (mins === 0) {
      timeDisplay = hoursText;
    } else {
      const minsText = mins === 1 ? 'דקה אחת' : `${mins} דקות`;
      timeDisplay = `${hoursText} ו-${minsText}`;
    }
  } else {
    const days = Math.floor(minutesSinceEntry / 1440);
    const hours = Math.floor((minutesSinceEntry % 1440) / 60);
    const daysText = days === 1 ? 'יום אחד' : `${days} ימים`;
    if (hours === 0) {
      timeDisplay = daysText;
    } else {
      const hoursText = hours === 1 ? 'שעה אחת' : `${hours} שעות`;
      timeDisplay = `${daysText} ו-${hoursText}`;
    }
  }

  return (
    <Badge className={`${colorClass} font-mono`}>
      <Icon className="h-3 w-3 me-1" />
      {timeDisplay}
    </Badge>
  );
}