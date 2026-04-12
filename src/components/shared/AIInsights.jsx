import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Sparkles, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { buildLeadsById, filterLeadsForUser, filterOrdersForUser, filterQuotesForUser } from '@/lib/rbac';
import { fetchAllList } from '@/lib/base44Pagination';

const getQuickQuestionsForRole = (user) => {
  if (!user) return [];
  
  if (user.role === 'admin') {
    return [
      "מה המכירות היום?",
      "כמה לידים לא משויכים?",
      "מה הביצועים של הנציגים?",
      "כמה הזמנות בייצור?",
      "מה הסטטוס של התשלומים?",
      "כמה קריאות שירות פתוחות?",
    ];
  } else if (user.department === 'factory') {
    return [
      "כמה הזמנות בייצור?",
      "מה המלאי הנמוך?",
      "כמה משלוחים ממתינים?",
      "כמה החזרות פעילות?",
      "מה הפניות הפתוחות?",
      "מה ההזמנות הדחופות?",
    ];
  } else {
    // Sales user
    return [
      "כמה לידים יש לי היום?",
      "מה המשימות שלי להיום?",
      "כמה הצעות מחיר שלחתי השבוע?",
      "מה ההזמנות שלי החודש?",
      "איזה לידים שלי דורשים מעקב?",
      "מה סטטוס ההצעות שלי?",
    ];
  }
};

export default function AIInsights({ isOpen, onClose, user }) {
  const [query, setQuery] = useState('');
  const [answer, setAnswer] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const handleAsk = async (question = query) => {
    if (!question.trim() || !user) return;

    setIsAnalyzing(true);
    setAnswer(null);

    try {
      // RBAC: Fetch only allowed data based on role and department
      const today = new Date().toISOString().split('T')[0];
      let context = {};
      
      if (user.role === 'admin') {
        // Admin sees everything
        const [leads, orders, quotes, tickets, commissions, users, inventory, deliveries, returns, salesTasks] = await Promise.all([
          fetchAllList(base44.entities.Lead),
          fetchAllList(base44.entities.Order),
          fetchAllList(base44.entities.Quote),
          fetchAllList(base44.entities.SupportTicket),
          fetchAllList(base44.entities.Commission),
          base44.entities.User.list(),
          fetchAllList(base44.entities.InventoryItem),
          fetchAllList(base44.entities.DeliveryShipment),
          fetchAllList(base44.entities.ReturnRequest),
          fetchAllList(base44.entities.SalesTask),
        ]);
        
        context = {
          user_role: 'admin',
          leads_total: leads.length,
          leads_unassigned: leads.filter(l => !l.rep1).length,
          leads_today: leads.filter(l => l.created_date?.startsWith(today)).length,
          leads_by_status: leads.reduce((acc, l) => { acc[l.status] = (acc[l.status] || 0) + 1; return acc; }, {}),
          orders_total: orders.length,
          orders_today: orders.filter(o => o.created_date?.startsWith(today)).length,
          orders_in_production: orders.filter(o => ['in_production', 'materials_check', 'not_started'].includes(o.production_status)).length,
          orders_pending_delivery: orders.filter(o => ['need_scheduling', 'scheduled'].includes(o.delivery_status)).length,
          revenue_total: orders.reduce((sum, o) => sum + (o.total || 0), 0),
          revenue_today: orders.filter(o => o.created_date?.startsWith(today)).reduce((sum, o) => sum + (o.total || 0), 0),
          revenue_paid: orders.filter(o => o.payment_status === 'paid').reduce((sum, o) => sum + (o.total || 0), 0),
          quotes_total: quotes.length,
          quotes_pending: quotes.filter(q => q.status === 'sent').length,
          tickets_open: tickets.filter(t => ['open', 'in_progress'].includes(t.status)).length,
          tickets_urgent: tickets.filter(t => t.priority === 'urgent').length,
          commissions_pending: commissions.filter(c => c.status === 'pending').reduce((sum, c) => sum + (c.total_commission || 0), 0),
          reps_performance: users.filter(u => u.department === 'sales').map(rep => ({
            name: rep.full_name,
            leads: leads.filter(l => l.rep1 === rep.email).length,
            orders: orders.filter(o => o.rep1 === rep.email).length,
          })),
          inventory_low: inventory.filter(i => i.min_threshold && i.qty_on_hand <= i.min_threshold).length,
          deliveries_pending: deliveries.filter(d => ['need_scheduling', 'scheduled', 'dispatched'].includes(d.status)).length,
          returns_active: returns.filter(r => !['closed', 'rejected'].includes(r.status)).length,
          sales_tasks_total: salesTasks.length,
        };
      } else if (user.department === 'factory') {
        // Factory user: Only factory-related data, NO financial info
        const [orders, tickets, inventory, deliveries, returns, products] = await Promise.all([
          fetchAllList(base44.entities.Order),
          fetchAllList(base44.entities.SupportTicket),
          fetchAllList(base44.entities.InventoryItem),
          fetchAllList(base44.entities.DeliveryShipment),
          fetchAllList(base44.entities.ReturnRequest),
          fetchAllList(base44.entities.ProductCatalog),
        ]);
        
        context = {
          user_role: 'factory',
          user_name: user.full_name,
          orders_total: orders.length,
          orders_in_production: orders.filter(o => ['in_production', 'materials_check', 'not_started'].includes(o.production_status)).length,
          orders_ready: orders.filter(o => o.production_status === 'ready').length,
          orders_urgent: orders.filter(o => {
            const daysOld = Math.floor((Date.now() - new Date(o.created_date)) / (1000 * 60 * 60 * 24));
            return daysOld > 7 && o.production_status !== 'ready';
          }).length,
          orders_by_production_status: orders.reduce((acc, o) => { acc[o.production_status] = (acc[o.production_status] || 0) + 1; return acc; }, {}),
          inventory_total_items: inventory.length,
          inventory_low: inventory.filter(i => i.min_threshold && i.qty_on_hand <= i.min_threshold).length,
          inventory_low_items: inventory.filter(i => i.min_threshold && i.qty_on_hand <= i.min_threshold).map(i => ({ name: i.name, qty: i.qty_on_hand, min: i.min_threshold })),
          deliveries_pending: deliveries.filter(d => ['need_scheduling', 'scheduled'].includes(d.status)).length,
          deliveries_in_transit: deliveries.filter(d => ['dispatched', 'in_transit'].includes(d.status)).length,
          tickets_open: tickets.filter(t => ['open', 'in_progress'].includes(t.status)).length,
          tickets_urgent: tickets.filter(t => t.priority === 'urgent').length,
          returns_active: returns.filter(r => !['closed', 'rejected'].includes(r.status)).length,
          returns_pending_pickup: returns.filter(r => r.pickup_status === 'scheduled').length,
          products_total: products.length,
          products_active: products.filter(p => p.is_active).length,
        };
      } else {
        // Sales user: Only THEIR assigned data
        const [allLeads, allOrders, allQuotes, allSalesTasks] = await Promise.all([
          fetchAllList(base44.entities.Lead),
          fetchAllList(base44.entities.Order),
          fetchAllList(base44.entities.Quote),
          fetchAllList(base44.entities.SalesTask),
        ]);
        
        // Filter to only user's assigned items
        const leadsById = buildLeadsById(allLeads);
        const myLeads = filterLeadsForUser(user, allLeads);
        const myOrders = filterOrdersForUser(user, allOrders);
        const myQuotes = filterQuotesForUser(user, allQuotes, leadsById);
        const myTasks = allSalesTasks.filter(t =>
          t.assigned_to === user.email ||
          t.rep1 === user.email ||
          t.rep2 === user.email ||
          t.pending_rep_email === user.email
        );
        
        context = {
          user_role: 'sales',
          user_name: user.full_name,
          my_leads_total: myLeads.length,
          my_leads_today: myLeads.filter(l => l.created_date?.startsWith(today)).length,
          my_leads_by_status: myLeads.reduce((acc, l) => { acc[l.status] = (acc[l.status] || 0) + 1; return acc; }, {}),
          my_leads_need_action: myLeads.filter(l => !l.first_action_at).length,
          my_tasks_total: myTasks.length,
          my_tasks_by_status: myTasks.reduce((acc, t) => { acc[t.status] = (acc[t.status] || 0) + 1; return acc; }, {}),
          my_orders_total: myOrders.length,
          my_orders_today: myOrders.filter(o => o.created_date?.startsWith(today)).length,
          my_orders_this_month: myOrders.filter(o => {
            const orderDate = new Date(o.created_date);
            const now = new Date();
            return orderDate.getMonth() === now.getMonth() && orderDate.getFullYear() === now.getFullYear();
          }).length,
          my_quotes_total: myQuotes.length,
          my_quotes_pending: myQuotes.filter(q => q.status === 'sent').length,
          my_quotes_this_week: myQuotes.filter(q => {
            const diffDays = Math.floor((Date.now() - new Date(q.created_date)) / (1000 * 60 * 60 * 24));
            return diffDays <= 7;
          }).length,
        };
      }

      // Call AI to analyze with role-specific prompt
      let systemPrompt = '';
      if (user.role === 'admin') {
        systemPrompt = 'אתה עוזר AI למערכת CRM למכירות של מזרונים. אתה עונה למנהל המערכת ויש לך גישה מלאה לכל הנתונים במערכת.';
      } else if (user.department === 'factory') {
        systemPrompt = 'אתה עוזר AI למערכת CRM למכירות של מזרונים. אתה עונה לנציג מפעל - ענה רק על נושאים הקשורים לייצור, מלאי, משלוחים, החזרות ושירות לקוחות. אל תספק מידע על מכירות, הכנסות או ביצועים פיננסיים.';
      } else {
        systemPrompt = `אתה עוזר AI למערכת CRM למכירות של מזרונים. אתה עונה לנציג מכירות בשם ${user.full_name} - ענה רק על הנתונים האישיים שלו/שלה (הלידים, המשימות, ההזמנות וההצעות המשויכות אליו/ה). אל תספק מידע כללי על החברה או נציגים אחרים.`;
      }
      
      const response = await base44.integrations.Core.InvokeLLM({
        prompt: `${systemPrompt}
        
השאלה של המשתמש: "${question}"

הנה הנתונים הרלוונטיים:
${JSON.stringify(context, null, 2)}

תן תשובה מפורטת ומועילה בעברית. כלול מספרים קונקרטיים ותובנות רלוונטיות.
התשובה צריכה להיות:
1. ממוקדת בשאלה של המשתמש
2. לכלול נתונים ספציפיים מהמערכת
3. להציע תובנות או המלצות אם רלוונטי
4. בשפה ברורה ומקצועית

${user.role !== 'admin' ? 'חשוב: ענה רק בהתבסס על הנתונים שסופקו לך ואל תתייחס לנושאים שאינם ברשותך.' : ''}`,
        add_context_from_internet: false
      });

      setAnswer(response);
    } catch (error) {
      setAnswer("מצטער, אירעה שגיאה בניתוח הנתונים. אנא נסה שוב.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleQuickQuestion = (q) => {
    setQuery(q);
    handleAsk(q);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            תובנות AI
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4 flex-1 overflow-y-auto">
          {/* Search Input */}
          <div className="flex gap-2 sticky top-0 bg-white pb-3 z-10">
            <Input
              placeholder="שאל שאלה על הנתונים שלך..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAsk()}
              className="text-base"
              autoFocus
            />
            <Button 
              onClick={() => handleAsk()}
              disabled={isAnalyzing || !query.trim()}
              className="bg-primary hover:bg-primary/90"
            >
              {isAnalyzing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
            </Button>
          </div>

          {/* Quick Questions */}
          {!answer && !isAnalyzing && (
            <div>
              <p className="text-sm text-muted-foreground mb-3">שאלות מהירות:</p>
              <div className="grid grid-cols-2 gap-2">
                {getQuickQuestionsForRole(user).map((q, idx) => (
                  <Button
                    key={idx}
                    variant="outline"
                    className="text-right justify-start h-auto py-3 hover:bg-primary/5 hover:border-primary/30"
                    onClick={() => handleQuickQuestion(q)}
                  >
                    {q}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {/* Loading State */}
          {isAnalyzing && (
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center gap-3">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  <div>
                    <p className="font-medium">מנתח את הנתונים...</p>
                    <p className="text-sm text-muted-foreground">טוען מידע מהמערכת ומייצר תובנות</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Answer */}
          {answer && !isAnalyzing && (
            <Card className="bg-gradient-to-br from-primary/5 to-purple-50">
              <CardContent className="p-6">
                <div className="flex items-start gap-3 mb-4">
                  <div className="p-2 bg-primary rounded-lg">
                    <Sparkles className="h-5 w-5 text-white" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-foreground mb-1">תשובת AI</h3>
                    <p className="text-sm text-muted-foreground">{query}</p>
                  </div>
                </div>
                <div className="prose prose-sm max-w-none text-foreground whitespace-pre-wrap leading-relaxed">
                  {answer}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setAnswer(null);
                    setQuery('');
                  }}
                  className="mt-4"
                >
                  שאל שאלה נוספת
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Empty State */}
          {!answer && !isAnalyzing && (
            <div className="text-center py-8 text-muted-foreground">
              <Sparkles className="h-12 w-12 mx-auto mb-3 text-muted-foreground/40" />
              <p className="font-medium mb-1">שאל שאלה על הנתונים שלך</p>
              <p className="text-sm">אנתח את הנתונים ואתן לך תובנות מועילות</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
