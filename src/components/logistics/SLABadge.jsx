import React from 'react';
import { Badge } from "@/components/ui/badge";
import { Clock, AlertTriangle, CheckCircle } from "lucide-react";
import { differenceInBusinessDays, parseISO } from 'date-fns';

// חישוב ימי עסקים שנותרו עד דד-ליין
function calculateSLADaysRemaining(orderCreatedDate) {
  if (!orderCreatedDate) return null;
  
  const created = parseISO(orderCreatedDate);
  const today = new Date();
  const slaDeadline = new Date(created);
  
  // הוספת 14 ימי עסקים
  let businessDaysAdded = 0;
  while (businessDaysAdded < 14) {
    slaDeadline.setDate(slaDeadline.getDate() + 1);
    const dayOfWeek = slaDeadline.getDay();
    // דלג על שישי (5) ושבת (6)
    if (dayOfWeek !== 5 && dayOfWeek !== 6) {
      businessDaysAdded++;
    }
  }
  
  // חישוב ימי עסקים שנותרו
  return differenceInBusinessDays(slaDeadline, today);
}

export default function OrderSLABadge({ orderCreatedDate, status }) {
  // אם המשלוח כבר נמסר, הצג סטטוס מוצלח
  if (status === 'delivered') {
    return (
      <Badge className="bg-green-100 text-green-800 border-green-200">
        <CheckCircle className="h-3 w-3 me-1" />
        נמסר בהצלחה
      </Badge>
    );
  }

  const daysRemaining = calculateSLADaysRemaining(orderCreatedDate);
  
  if (daysRemaining === null) {
    return null;
  }

  // לוגיקת הרמזור
  if (daysRemaining <= 3) {
    // 🔴 קריטי
    return (
      <Badge className="bg-red-100 text-red-800 border-red-200 font-semibold">
        <AlertTriangle className="h-3 w-3 me-1" />
        קריטי! {daysRemaining} ימים
      </Badge>
    );
  } else if (daysRemaining <= 7) {
    // 🟡 אזהרה
    return (
      <Badge className="bg-amber-100 text-amber-800 border-amber-200">
        <Clock className="h-3 w-3 me-1" />
        דחוף - {daysRemaining} ימים
      </Badge>
    );
  } else {
    // 🟢 בטוח
    return (
      <Badge className="bg-green-100 text-green-800 border-green-200">
        <Clock className="h-3 w-3 me-1" />
        {daysRemaining} ימים
      </Badge>
    );
  }
}

export { calculateSLADaysRemaining };