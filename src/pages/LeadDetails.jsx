import React, { useMemo, useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { cancelOpenTasksForStatus } from '@/lib/dealClose';
import StatusBadge from '@/components/shared/StatusBadge';
import LeadOverview from '@/components/lead/LeadOverview';
import { getRepDisplayName } from '@/lib/repDisplay';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue } from
"@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle } from
"@/components/ui/dialog";
import {
  Loader2,
  FileText,
  Headphones,
  ShoppingBag,
  AlertTriangle,
} from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import AddCommunication from '@/components/lead/AddCommunication';
import LeadMarketingSection from '@/components/lead/LeadMarketingSection';
import { leadMarketingFieldLabels } from '@/constants/leadMarketingFields';
import { formatLeadAge } from '@/lib/hebrewDuration';
import { Badge } from "@/components/ui/badge";
import SalesTaskDialog from '@/components/task/SalesTaskDialog';
import NewQuoteDialog from '@/components/quote/NewQuoteDialog';
import AddressAutocomplete from '@/components/shared/AddressAutocomplete';
import { useImpersonation } from '@/components/shared/ImpersonationContext';
import { createAuditLog } from '@/utils/auditLog';
import NewOrder from '@/pages/NewOrder';
import { LEAD_STATUS_OPTIONS, LEAD_SOURCE_OPTIONS } from '@/constants/leadOptions';
import StatusOptionRow from '@/components/shared/StatusOptionRow';
import { canViewLead } from '@/components/shared/rbac';
import CompleteTaskDialog from '@/components/sales/CompleteTaskDialog';
import { useRepeatEnquiries } from '@/lib/repeatEnquiries';
import { isSameRep, reconcileRepSlots } from '@/lib/repSlots';
import { canEditPrimaryRep, canEditSecondaryRep, canAccessSalesWorkspace } from '@/lib/rbac';
import { buildLeadWorkbenchState } from '@/lib/leadWorkbench';
import { useContactLeadIds } from '@/hooks/use-contact-lead-ids';
import { formatInTimeZone } from '@/lib/safe-date-fns-tz';
import RepSelectItem from '@/components/shared/RepSelectItem';

// What the customer actually bought, in one line — "מזרן עילית 1345 ×2 · בסיס
// מתכוונן". A total alone answers how much they spent, which is never the
// question a rep is asking when they open a returning customer's history; they
// want to know what is already in the house. The row truncates and keeps the
// full list in its tooltip.
function summarizeOrderItems(order) {
  const items = Array.isArray(order?.items) ? order.items : [];
  return items
    .filter((item) => item?.name)
    .map((item) => (Number(item.quantity) > 1 ? `${item.name} ×${item.quantity}` : item.name))
    .join(' · ');
}

export default function LeadDetails({ leadId: leadIdProp, initialMode: initialModeProp, isModal = false, onClose }) {
  const navigate = useNavigate();
  const { getEffectiveUser } = useImpersonation();
  const urlParams = new URLSearchParams(window.location.search);
  // When rendered as a popup the id/mode arrive as props and the URL is
  // left completely untouched, so the list page underneath keeps its
  // address, scroll and filters. Opened as a full page (deep link,
  // dashboard widget, global search) it falls back to the query string.
  const leadId = leadIdProp ?? urlParams.get('id');
  const initialMode = initialModeProp ?? (urlParams.get('mode') === 'service' ? 'service' : 'sales');

  const [isEditing, setIsEditing] = useState(false);
  // הצעות מחיר / שירות open only on a click; '' means both are closed.
  const [openSection, setOpenSection] = useState('');
  const [formData, setFormData] = useState({});
  const [showAddCommunication, setShowAddCommunication] = useState(false);
  const [showEditTaskDialog, setShowEditTaskDialog] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [showAddTaskDialog, setShowAddTaskDialog] = useState(false);
  // Create an order inline (as a dialog over the lead) instead of navigating
  // away — lets a rep close a walk-in sale without leaving the lead screen.
  const [showOrderDialog, setShowOrderDialog] = useState(false);
  // Create a quote inline (dialog over the lead). We own it locally rather than
  // via useCreationModal() because the lead overlay renders ABOVE the
  // CreationModal provider, so that context is a no-op here — which is exactly
  // why "הצעה חדשה" did nothing. Mirrors the order dialog above.
  const [showQuoteDialog, setShowQuoteDialog] = useState(false);
  // Gating dialog for "משימה חדשה" on unassigned leads — instead of
  // letting the rep open a task on a lead that has no owner (and then
  // wondering who's supposed to do it), we intercept and require an
  // assignment first. Holds the candidate rep email until confirmed.
  const [assignBeforeTaskRep, setAssignBeforeTaskRep] = useState('');
  const [showAssignBeforeTask, setShowAssignBeforeTask] = useState(false);
  const [isAssigningBeforeTask, setIsAssigningBeforeTask] = useState(false);
  // Task being closed from the "סיים" shortcut on the next-task strip.
  const [completingTask, setCompletingTask] = useState(null);
  // The old `workMode` state (sales vs service) was removed when we
  // collapsed the two modes into a single unified lead screen. Sales
  // and service info now live side-by-side, the service section is a
  // permanent card in the main column, and the only cross-functional
  // signal is the open-tickets badge in the header. `initialMode` is
  // still accepted as a prop for backwards-compat with any caller
  // that passes it; it's just ignored.
  void initialMode;
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleClickToCall = async (phone) => {
    if (!phone) return;
    try {
      toast({ title: "מתחיל שיחה...", description: phone });
      await base44.functions.invoke('clickToCall', { customerPhone: phone, leadId });
      toast({ title: "השיחה התחילה בהצלחה" });
      // clickToCall writes the call_logs row server-side (result "pending"
      // until the Voicenter sync resolves it), so refresh the contact card and
      // the activity feed — the call the rep just placed belongs on screen.
      queryClient.invalidateQueries({ queryKey: ['lead-contact-log', leadId] });
      queryClient.invalidateQueries({ queryKey: ['lead-call-logs', leadId] });
    } catch (err) {
      toast({
        title: "שגיאה בהתחלת שיחה",
        description: err?.response?.data?.error || err.message,
        variant: "destructive",
      });
    }
  };

  // All queries fire in parallel - no dependencies between them
  const { data: user = null } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
    staleTime: 300000,
  });

  const effectiveUser = getEffectiveUser(user);

  const { data: lead, isLoading } = useQuery({
    queryKey: ['lead', leadId],
    queryFn: () => base44.entities.Lead.filter({ id: leadId }).then(r => r[0] || null),
    enabled: !!leadId,
    staleTime: 5000,
  });

  const canViewCurrentLead = !!lead && canViewLead(effectiveUser, lead);

  const { data: tasks = [] } = useQuery({
    queryKey: ['tasks', leadId],
    queryFn: () => base44.entities.SalesTask.filter({ lead_id: leadId }),
    enabled: !!leadId && canViewCurrentLead,
    staleTime: 120000,
  });

  const { data: quotes = [] } = useQuery({
    queryKey: ['quotes', leadId],
    queryFn: () => base44.entities.Quote.filter({ lead_id: leadId }),
    enabled: !!leadId && canViewCurrentLead,
    staleTime: 120000,
  });

  const { data: orders = [] } = useQuery({
    queryKey: ['orders-by-lead', leadId],
    queryFn: () => base44.entities.Order.filter({ lead_id: leadId }),
    enabled: !!leadId && canViewCurrentLead,
    staleTime: 120000,
  });

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => base44.entities.User.list(),
    staleTime: 300000,
  });

  const linkedOrderIds = useMemo(
    () => [...new Set(orders.map((order) => order?.id).filter(Boolean))],
    [orders]
  );

  // "Has this person bought from us before?" — a question about the customer,
  // not about this lead row. A returning buyer's previous order hangs off the
  // enquiry they placed it from, which by definition is an earlier one, so a
  // per-row query answers "no orders" for exactly the customer worth knowing
  // about. Same scoping the contact log uses.
  const contactLeadIds = useContactLeadIds(lead);
  const { data: contactOrders = [] } = useQuery({
    queryKey: ['lead-contact-orders', leadId, contactLeadIds.join('|')],
    enabled: !!leadId && canViewCurrentLead && contactLeadIds.length > 0,
    staleTime: 120000,
    queryFn: async () => {
      const batches = await Promise.all(
        contactLeadIds.map((id) => base44.entities.Order.filter({ lead_id: id }))
      );
      const deduped = new Map();
      batches.flat().forEach((order) => {
        if (order?.id) deduped.set(order.id, order);
      });
      return [...deduped.values()].sort(
        (a, b) => new Date(b.created_date || 0) - new Date(a.created_date || 0)
      );
    },
  });

  const { data: serviceTickets = [] } = useQuery({
    queryKey: ['lead-service-tickets', leadId, linkedOrderIds.join('|')],
    queryFn: async () => {
      if (linkedOrderIds.length === 0) return [];
      const ticketBatches = await Promise.all(
        linkedOrderIds.map((orderId) => base44.entities.SupportTicket.filter({ order_id: orderId }))
      );
      const deduped = new Map();
      ticketBatches.flat().forEach((ticket) => {
        if (ticket?.id) deduped.set(ticket.id, ticket);
      });
      return [...deduped.values()];
    },
    enabled: !!leadId && canViewCurrentLead && linkedOrderIds.length > 0,
    staleTime: 120000,
  });

  const openServiceTicketsCount = useMemo(
    () => serviceTickets.filter(
      (ticket) => !['resolved', 'closed'].includes(String(ticket.status || '').toLowerCase())
    ).length,
    [serviceTickets]
  );

  // "פנייה נוספת" — is this row a repeat enquiry from someone who already
  // came in before? OtherEnquiriesCard lists the siblings themselves in the
  // overview's left column; the header just needs the one-glance marker.
  const leadForRepeatLookup = useMemo(() => (lead ? [lead] : []), [lead]);
  const repeatEnquiry = useRepeatEnquiries(leadForRepeatLookup).get(lead?.id);

  // Sync form data when lead loads or updates (for real-time status changes)
  const leadUpdatedDate = lead?.updated_date;
  React.useEffect(() => {
    if (lead && !isEditing) setFormData(lead);
  }, [leadUpdatedDate, isEditing]);

  // The URL ?mode=service sync useEffect was removed alongside the
  // sales/service toggle — the lead screen no longer has modes, so
  // there's nothing to sync. ?mode query params on existing bookmarks
  // are simply ignored (initialMode prop is no-op now).

  // Real-time subscription: auto-refresh lead when it changes (e.g. status updated from task dialog)
  useEffect(() => {
    if (!leadId) return;
    const unsubscribe = base44.entities.Lead.subscribe((event) => {
      if (event.id === leadId) {
        queryClient.invalidateQueries({ queryKey: ['lead', leadId] });
      }
    });
    return unsubscribe;
  }, [leadId, queryClient]);

  const updateLeadMutation = useMutation({
    mutationFn: (data) => base44.entities.Lead.update(leadId, data),
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries(['lead', leadId]);
      queryClient.invalidateQueries(['leadActivityLogs', leadId]);
      setIsEditing(false);
      // A status change sweeps the tasks the new status no longer justifies.
      // Closing a deal does nothing beyond marking it closed — no jump to the
      // order form, no tasks cancelled; the rep writes the order when they're
      // ready, and the appointment they booked stays booked.
      if (variables?.status && variables.status !== lead?.status) {
        cancelOpenTasksForStatus(leadId, variables.status).catch(() => {});
      }
    },
    onError: (err) => toast({ title: 'עדכון הליד נכשל', description: err?.message || 'שגיאה לא צפויה', variant: 'destructive' }),
  });

  // Notes have their own save path rather than reusing updateLeadMutation:
  // that one closes the edit mode on success, which would throw away whatever
  // the rep had typed into the other fields the moment they blurred the notes
  // box. Nothing else about a lead changes here, so nothing else needs to.
  const handleSaveNotes = async (notes) => {
    try {
      await base44.entities.Lead.update(leadId, { notes });
      queryClient.invalidateQueries({ queryKey: ['lead', leadId] });
      queryClient.invalidateQueries({ queryKey: ['leadActivityLogs', leadId] });
    } catch (err) {
      toast({
        title: 'שמירת ההערות נכשלה',
        description: err?.message || 'שגיאה לא צפויה',
        variant: 'destructive',
      });
    }
  };

  const convertToCustomerMutation = useMutation({
    mutationFn: async () => {
      // Check if customer already exists
      const existingCustomers = await base44.entities.Customer.filter({ phone: lead.phone });
      if (existingCustomers.length > 0) {
        throw new Error('לקוח כבר קיים במערכת');
      }

      // Create customer
      const customer = await base44.entities.Customer.create({
        full_name: lead.full_name,
        phone: lead.phone,
        // Carried over with the rest of the contact details — the second number
        // is worth as much on the customer card as it was on the lead.
        phone_2: lead.phone_2,
        email: lead.email,
        address: lead.address,
        city: lead.city,
        lead_id: leadId,
        original_source: lead.source,
        total_orders: 0,
        total_revenue: 0,
        lifetime_value: 0,
        account_manager: lead.rep1 || effectiveUser?.email
      });

      // Update lead status to won
      await base44.entities.Lead.update(leadId, { status: 'won' });

      await createAuditLog({
        leadId,
        actionType: 'converted_to_customer',
        description: `${user?.full_name || 'משתמש'} המיר את הליד ללקוח`,
        user,
      });

      return customer;
    },
    onSuccess: (customer) => {
      toast({ title: 'הליד הומר ללקוח' });
      queryClient.invalidateQueries(['lead', leadId]);
      navigate(createPageUrl('CustomerDetails') + `?id=${customer.id}`);
    },
    onError: (err) => toast({ title: 'ההמרה ללקוח נכשלה', description: err?.message || 'שגיאה לא צפויה', variant: 'destructive' }),
  });

  const isAdmin = effectiveUser?.role === 'admin';
  const canEdit = isAdmin || lead?.rep1 === effectiveUser?.email || lead?.rep2 === effectiveUser?.email || lead?.pending_rep_email === effectiveUser?.email;
  const canEditLeadRep1 = canEditPrimaryRep(effectiveUser);
  const canEditLeadRep2 = canEditSecondaryRep(effectiveUser, lead);
  const workbenchState = useMemo(() => buildLeadWorkbenchState({
    tasks,
  }), [tasks]);

  const handleSave = async () => {
    const { id, created_date, updated_date, created_by, ...editedFields } = formData;

    // The two rep slots belong to two different people. The pickers already
    // enforce it, so this catches the ways in that don't go through them — a
    // stale form, a value carried over from before the rule existed.
    const { patch: updateData, clearedSecondary } = reconcileRepSlots(lead, editedFields);

    // Audit log for each changed field
    const fieldLabels = {
      full_name: 'שם',
      phone: 'טלפון',
      phone_2: 'טלפון נוסף',
      email: 'אימייל',
      city: 'עיר',
      address: 'כתובת',
      status: 'סטטוס',
      source: 'מקור',
      rep1: 'נציג ראשי',
      rep2: 'נציג משני',
      notes: 'הערות',
      ...leadMarketingFieldLabels,
    };
    const fieldsToCheck = Object.keys(fieldLabels);

    for (const field of fieldsToCheck) {
      // Read the value we're actually about to save, not the raw form — so a
      // rep2 the reconcile just cleared is logged as cleared.
      const nextValue = field in updateData ? updateData[field] : lead[field];
      if (nextValue !== lead[field] && (nextValue || lead[field])) {
        const isRep = field === 'rep1' || field === 'rep2';
        await createAuditLog({
          leadId,
          actionType: isRep ? 'rep_changed' : field === 'status' ? 'status_changed' : 'field_updated',
          description: `${user.full_name} שינה ${fieldLabels[field]}: "${lead[field] || '(ריק)'}" → "${nextValue || '(ריק)'}"`,
          user,
          fieldName: field,
          oldValue: lead[field],
          newValue: nextValue,
        });
      }
    }

    if (clearedSecondary) {
      toast({
        title: 'הנציג המשני נוקה',
        description: 'אותו נציג לא יכול להיות גם ראשי וגם משני — אפשר לשייך נציג משני אחר.',
      });
    }

    queryClient.invalidateQueries(['leadActivityLogs', leadId]);
    updateLeadMutation.mutate(updateData);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>);

  }

  if (!lead) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">הליד לא נמצא</p>
        {isModal ? (
          <Button className="mt-4" onClick={onClose}>סגור</Button>
        ) : (
          <Link to={createPageUrl('Leads')}>
            <Button className="mt-4">חזור לרשימת הלידים</Button>
          </Link>
        )}
      </div>);

  }

  // Lead lookup, intentionally cross-rep: any sales rep may open any lead so a
  // walk-in customer can be served by whoever is free. Ownership never moves
  // here — rep1 is admin-only (canEditPrimaryRep) and the rep2/edit controls
  // need `canEdit` (owner/admin), so a non-owner can view + work the lead but
  // can't claim it. A banner below makes the "view/serve, not yours" state
  // explicit. Only users outside the sales workspace are turned away.
  if (!canAccessSalesWorkspace(effectiveUser)) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground text-lg font-medium">אין לך הרשאות לצפות בליד זה.</p>
        {isModal ? (
          <Button className="mt-4 bg-primary hover:bg-primary/90" onClick={onClose}>סגור</Button>
        ) : (
          <Link to={createPageUrl('Leads')}>
            <Button className="mt-4 bg-primary hover:bg-primary/90">חזור לרשימת הלידים</Button>
          </Link>
        )}
      </div>
    );
  }

  const salesReps = users.filter((u) => u.role === 'user' || u.role === 'admin');

  const handleQuickAssignRep1 = async (email) => {
    const repName = salesReps.find(r => r.email === email)?.full_name || email;

    try {
      const openAssignmentTasks = tasks.filter(t =>
        t.task_status === 'not_completed' && (!t.rep1 || t.task_type === 'assignment')
      );

      const assignerName = user?.full_name || 'מנהל';

      if (openAssignmentTasks.length > 0) {
        await Promise.all(openAssignmentTasks.map(t =>
          base44.entities.SalesTask.update(t.id, {
            task_status: 'completed',
            rep1: email,
            summary: `${assignerName} שייך את הליד לנציג ${repName}`,
          })
        ));
      } else {
        await base44.entities.SalesTask.create({
          lead_id: leadId,
          rep1: email,
          task_type: 'assignment',
          task_status: 'completed',
          summary: `${assignerName} שייך את הליד לנציג ${repName}`,
          work_start_date: new Date().toISOString(),
        });
      }

      // 3. No "יש להתקשר ללקוח" task. Assigning a lead doesn't schedule
      //    anything — a task opens by itself only for the statuses that ARE a
      //    scheduled commitment (see AUTO_TASK_STATUSES). The rep just got the
      //    lead; they know to call it.

      // 4. Audit log
      await createAuditLog({
        leadId,
        actionType: 'rep_assigned',
        description: `${user.full_name} שייך את הליד לנציג ${repName}`,
        user,
        fieldName: 'rep1',
        oldValue: lead.rep1 || 'לא משויך',
        newValue: email,
      });

      // 5. Update lead. Assigning the lead to whoever was its secondary rep
      //    frees the secondary slot — they own it now.
      const { patch, clearedSecondary } = reconcileRepSlots(lead, { rep1: email });
      if (clearedSecondary) {
        await createAuditLog({
          leadId,
          actionType: 'rep_changed',
          description: `הנציג המשני נוקה — ${repName} הפך/ה לנציג הראשי`,
          user,
          fieldName: 'rep2',
          oldValue: lead.rep2,
          newValue: '',
        });
      }
      updateLeadMutation.mutate(patch);
      queryClient.invalidateQueries(['tasks', leadId]);
      queryClient.invalidateQueries(['leadActivityLogs', leadId]);
    } catch (error) {
      // Assignment error - non-critical
    }
  };

  // Single entry point for "open the add-task dialog". If the lead
  // already has a primary rep, opens the dialog directly. If not,
  // intercepts with the assign-first gate so a task can never be
  // attached to an owner-less lead. Every "משימה חדשה" trigger in
  // this screen goes through here.
  const requestAddTask = () => {
    if (lead?.rep1) {
      setShowAddTaskDialog(true);
    } else {
      setAssignBeforeTaskRep('');
      setShowAssignBeforeTask(true);
    }
  };

  // The lead status is changed only through a task (that's where the smart
  // no-answer / follow-up scheduling lives), so clicking the status card opens
  // the lead's most recent task — there the rep updates the status and records
  // what happened. If the lead has no task yet, start a new one.
  const openLastTask = () => {
    const sorted = [...tasks].sort(
      (a, b) => new Date(b.created_date || 0) - new Date(a.created_date || 0),
    );
    // Prefer the latest still-open task (that's where the status actually
    // gets changed); otherwise the most recent task; with none, start one.
    const target = sorted.find(
      (t) => String(t?.task_status || '').toLowerCase() === 'not_completed',
    ) || sorted[0];
    if (target) {
      setEditingTask(target);
      setShowEditTaskDialog(true);
    } else {
      requestAddTask();
    }
  };

  // Confirm handler for the assign-first gate: assigns the chosen rep
  // via the existing full quick-assign flow (which also creates the
  // standard call-back task and audit log), then immediately opens
  // the add-task dialog so the user lands exactly where they tried
  // to go in the first place — no second click required.
  const confirmAssignThenAddTask = async () => {
    if (!assignBeforeTaskRep || isAssigningBeforeTask) return;
    setIsAssigningBeforeTask(true);
    try {
      await handleQuickAssignRep1(assignBeforeTaskRep);
      setShowAssignBeforeTask(false);
      setShowAddTaskDialog(true);
    } finally {
      setIsAssigningBeforeTask(false);
    }
  };

  // Clearing a slot. A rep picked by mistake used to be permanent from this
  // card — there was no "none" to choose — so an admin was stuck with a wrong
  // assignment. Both slots are clearable; the permission gates are unchanged
  // (primary is admin-only, secondary follows canEditSecondaryRep).
  const handleRemoveRep = async (field) => {
    const label = field === 'rep1' ? 'נציג ראשי' : 'נציג משני';
    const previous = lead[field];
    if (!previous) return;

    await createAuditLog({
      leadId,
      actionType: 'rep_changed',
      description: `${user?.full_name || 'משתמש'} הסיר ${label}: ${getRepDisplayName(previous, salesReps)}`,
      user,
      fieldName: field,
      oldValue: previous,
      newValue: '',
    });

    updateLeadMutation.mutate({ [field]: '' });
    queryClient.invalidateQueries(['leadActivityLogs', leadId]);
  };

  const handleQuickAssignRep2 = async (email) => {
    const repName = salesReps.find(r => r.email === email)?.full_name || email;

    // The picker doesn't offer the primary rep, but this handler is also the
    // one the RepCard shortcut calls — so refuse the duplicate here too.
    if (isSameRep(email, lead.rep1)) {
      toast({
        title: 'אי אפשר לשייך את אותו נציג פעמיים',
        description: `${repName} כבר הנציג הראשי של הליד. נציג משני נועד לנציג אחר.`,
        variant: 'destructive',
      });
      return;
    }

    const openAssignmentTasks = tasks.filter(t =>
      t.task_status === 'not_completed' && (!t.rep1 || t.task_type === 'assignment')
    );

    if (openAssignmentTasks.length > 0) {
      await Promise.all(openAssignmentTasks.map(t =>
        base44.entities.SalesTask.update(t.id, { task_status: 'completed' })
      ));
    } else {
      await base44.entities.SalesTask.create({
        lead_id: leadId,
        rep2: email,
        task_type: 'assignment',
        task_status: 'completed',
        summary: `שיוך נציג משני: ${repName}`,
        work_start_date: new Date().toISOString(),
      });
    }

    await createAuditLog({
      leadId,
      actionType: 'rep_changed',
      description: `${user.full_name} שייך נציג משני: ${repName}`,
      user,
      fieldName: 'rep2',
      oldValue: lead.rep2 || 'לא משויך',
      newValue: email,
    });

    updateLeadMutation.mutate({ rep2: email });
    queryClient.invalidateQueries(['tasks', leadId]);
    queryClient.invalidateQueries(['leadActivityLogs', leadId]);
  };

  return (
    /* The whole top of the screen — identity, the five facts, the six
       actions, the next task, marketing and the activity track — is
       LeadOverview (the v6 layout). Everything this page still owns
       renders as its children, inside the same scroll area. */
    <>
      <LeadOverview
        lead={lead}
        tasks={tasks}
        users={users}
        salesReps={salesReps}
        queue={workbenchState.nowQueue}
        isModal={isModal}
        isEditing={isEditing}
        isSaving={updateLeadMutation.isPending}
        canEdit={canEdit}
        canEditRep1={canEditLeadRep1}
        canEditRep2={canEditLeadRep2}
        repeatEnquiry={repeatEnquiry}
        openServiceTicketsCount={openServiceTicketsCount}
        leadAge={lead.created_date ? formatLeadAge(lead.created_date) : ''}
        onBack={isModal ? onClose : () => navigate(createPageUrl('Leads'))}
        onCall={handleClickToCall}
        onOpenStatusTask={openLastTask}
        onSaveNotes={handleSaveNotes}
        onAssignRep1={handleQuickAssignRep1}
        onAssignRep2={handleQuickAssignRep2}
        onRemoveRep={handleRemoveRep}
        onToggleEdit={() => (isEditing ? handleSave() : setIsEditing(true))}
        onAddTask={requestAddTask}
        onNewQuote={() => setShowQuoteDialog(true)}
        onNewOrder={() => setShowOrderDialog(true)}
        onAddCommunication={() => setShowAddCommunication(true)}
        onConvertToCustomer={() => convertToCustomerMutation.mutate()}
        canConvertToCustomer={lead.status !== 'won' && !convertToCustomerMutation.isPending}
        onOpenTask={(task) => { setEditingTask(task); setShowEditTaskDialog(true); }}
        // Closing a task from the card runs the same "מה קרה?" flow the tasks
        // screen uses, so an outcome is still recorded and the follow-up can
        // be scheduled.
        onCompleteTask={(task) => setCompletingTask({
          ...task,
          rep1: task.rep1 || lead?.rep1,
          rep2: task.rep2 || lead?.rep2,
        })}
        onOpenServiceSection={() => {
          document.getElementById('lead-service-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }}
      >

      {/* Cross-rep view/serve banner — shown when this rep isn't the owner
          (and isn't admin). Makes clear the lead belongs to someone else and
          that working it here won't transfer ownership. */}
      {!canEdit && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 text-amber-900 px-4 py-2.5 text-sm flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <span>
            {lead.rep1 ? (
              <>ליד זה משויך ל<span className="font-semibold">{getRepDisplayName(lead.rep1, users)}</span> — מצב טיפול. אפשר לראות פרטים והיסטוריה ולטפל בלקוח; הבעלות על הליד לא משתנה.</>
            ) : (
              <>ליד לא משויך — אפשר לראות פרטים והיסטוריה ולטפל בלקוח.</>
            )}
          </span>
        </div>
      )}

        {/* Pending rep — the integration named someone but the lead is still
            unassigned. Lifted out of the primary slot so the essentials bar
            keeps its single-row height; it's a call to action, and it belongs
            on its own line where it can say what it wants. */}
        {!lead.rep1 && lead.pending_rep_email && !isEditing && (
          <div className="flex items-center gap-2 flex-wrap rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
            <span className="text-xs font-medium text-amber-700 flex-shrink-0">נציג ממתין לשיוך:</span>
            <span className="text-sm text-amber-900 min-w-0 truncate flex-1">
              {salesReps.find((r) => r.email === lead.pending_rep_email)?.full_name || lead.pending_rep_email}
            </span>
            {isAdmin && (
              <Button
                size="sm"
                className="bg-amber-600 hover:bg-amber-700 h-7 text-xs flex-shrink-0"
                onClick={async () => {
                            const repName = salesReps.find(r => r.email === lead.pending_rep_email)?.full_name || lead.pending_rep_email;
                            const openAssignmentTasks = tasks.filter(t =>
                              t.task_status === 'not_completed' && (!t.rep1 || t.task_type === 'assignment')
                            );

                            if (openAssignmentTasks.length > 0) {
                              await Promise.all(openAssignmentTasks.map(t =>
                                base44.entities.SalesTask.update(t.id, { task_status: 'completed' })
                              ));
                            } else {
                              await base44.entities.SalesTask.create({
                                lead_id: leadId,
                                rep1: lead.pending_rep_email,
                                task_type: 'assignment',
                                task_status: 'completed',
                                summary: `שיוך לנציג: ${repName}`,
                                work_start_date: new Date().toISOString(),
                              });
                            }

                            await createAuditLog({
                              leadId,
                              actionType: 'rep_assigned',
                              description: `${user.full_name} שייך את הליד לנציג ${lead.pending_rep_email}`,
                              user,
                              fieldName: 'rep1',
                              oldValue: 'לא משויך',
                              newValue: lead.pending_rep_email,
                            });
                            updateLeadMutation.mutate(
                              reconcileRepSlots(lead, {
                                rep1: lead.pending_rep_email,
                                pending_rep_email: null,
                              }).patch,
                            );
                  queryClient.invalidateQueries(['tasks', leadId]);
                  queryClient.invalidateQueries(['leadActivityLogs', leadId]);
                }}
                disabled={updateLeadMutation.isPending}
              >
                שייך נציג זה כראשי
              </Button>
            )}
          </div>
        )}

        {/* Other enquiries from the same person moved up into the overview's
            left column (LeadOverview), next to the next task — a rep must know
            they are calling someone who already contacted us before they pick
            up the phone, and a strip at the foot of the page was neither seen
            in time nor able to show more than one of them. */}

        {/* Editing the lead. There is no read-only twin of this card any
            more: the overview above shows the lead's facts, so a second
            copy of them down here was the screen saying everything twice.
            The form is what's left — it opens from "ערוך ליד" and holds
            the fields the overview has no control for, marketing included. */}
        {isEditing && (
          <Card className="rounded-xl border-border shadow-card overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between border-b border-border/50 bg-muted/50 py-3">
              <CardTitle className="text-sm font-semibold">עריכת ליד</CardTitle>
              <span className="text-[11px] text-muted-foreground/70">
                נציגים משתנים מרצועת הפרטים למעלה
              </span>
            </CardHeader>
            <CardContent className="p-5">
                <div className="space-y-4">
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">שם ושם משפחה</Label>
                      <Input value={formData.full_name || ''} onChange={(e) => setFormData({ ...formData, full_name: e.target.value })} className="h-9" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">טלפון</Label>
                      <Input value={formData.phone || ''} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} className="h-9" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">טלפון נוסף</Label>
                      <Input value={formData.phone_2 || ''} onChange={(e) => setFormData({ ...formData, phone_2: e.target.value })} className="h-9" dir="ltr" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">אימייל</Label>
                      <Input type="email" value={formData.email || ''} onChange={(e) => setFormData({ ...formData, email: e.target.value })} className="h-9" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">עיר</Label>
                      <Input value={formData.city || ''} onChange={(e) => setFormData({ ...formData, city: e.target.value })} className="h-9" />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">כתובת</Label>
                    <AddressAutocomplete
                      value={formData.address || ''}
                      onChange={(value, details) => {
                        setFormData((prev) => ({
                          ...prev,
                          address: value,
                          ...(details?.city ? { city: details.city } : {}),
                        }));
                      }}
                      className="h-9"
                      placeholder="התחל להקליד..."
                    />
                  </div>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">סטטוס</Label>
                      <Select value={formData.status || ''} onValueChange={(value) => setFormData({ ...formData, status: value })}>
                        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {LEAD_STATUS_OPTIONS.map(opt => (
                            <SelectItem key={opt.value} value={opt.value}>
                              <StatusOptionRow status={opt.value} label={opt.label} />
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">מקור</Label>
                      <Select value={formData.source || ''} onValueChange={(value) => setFormData({ ...formData, source: value })}>
                        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {LEAD_SOURCE_OPTIONS.map(opt => (
                            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">הערות</Label>
                    <Textarea value={formData.notes || ''} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} rows={3} />
                  </div>

                  {/* Marketing fields moved here when the "שיווק ומקור" tab
                      went away. The overview's פרטי שיווק card shows the five
                      UTM values read-only; everything else — the facebook_*
                      set, landing page, click id — is still editable, just
                      from the form instead of from a tab of its own. */}
                  <div className="space-y-2 border-t border-border/50 pt-4">
                    <Label className="text-xs text-muted-foreground">מידע שיווקי</Label>
                    <LeadMarketingSection
                      data={formData}
                      onChange={(field, value) => setFormData({ ...formData, [field]: value })}
                    />
                  </div>
                </div>

            </CardContent>
          </Card>
        )}

        {/* הצעות מחיר ושירות — closed until you ask for them. Both are
            lists you consult, not things you read on the way in, so the
            section starts collapsed and a click on the tab opens it (a
            second click closes it again). "שיווק ומקור" is gone: the facts
            strip and the פרטי שיווק card above already say it.

            Controlled with no onValueChange on purpose — the triggers own
            the toggle, and letting Radix set the value too would re-open a
            section on the same click that closed it. */}
        <Tabs value={openSection} dir="rtl" className="w-full">
          <TabsList className="bg-muted rounded-lg p-1 gap-1 h-auto flex flex-wrap justify-start">
            <TabsTrigger
              value="quotes"
              onClick={() => setOpenSection((current) => (current === 'quotes' ? '' : 'quotes'))} className="group data-[state=active]:bg-card data-[state=active]:shadow-sm rounded-md px-3.5 py-1.5 text-sm">
              הצעות מחיר
              <span className="ms-1.5 inline-flex items-center justify-center rounded-full px-1.5 min-w-[18px] h-[18px] text-[10px] font-bold leading-none bg-muted-foreground/15 text-muted-foreground group-data-[state=active]:bg-primary group-data-[state=active]:text-primary-foreground">
                {quotes.length}
              </span>
            </TabsTrigger>
            <TabsTrigger
              value="orders"
              onClick={() => setOpenSection((current) => (current === 'orders' ? '' : 'orders'))} className="group data-[state=active]:bg-card data-[state=active]:shadow-sm rounded-md px-3.5 py-1.5 text-sm">
              הזמנות
              <span className="ms-1.5 inline-flex items-center justify-center rounded-full px-1.5 min-w-[18px] h-[18px] text-[10px] font-bold leading-none bg-muted-foreground/15 text-muted-foreground group-data-[state=active]:bg-primary group-data-[state=active]:text-primary-foreground">
                {contactOrders.length}
              </span>
            </TabsTrigger>
            <TabsTrigger
              value="service"
              onClick={() => setOpenSection((current) => (current === 'service' ? '' : 'service'))} className="group data-[state=active]:bg-card data-[state=active]:shadow-sm rounded-md px-3.5 py-1.5 text-sm">
              שירות
              <span className={`ms-1.5 inline-flex items-center justify-center rounded-full px-1.5 min-w-[18px] h-[18px] text-[10px] font-bold leading-none ${
                openServiceTicketsCount > 0
                  ? 'bg-amber-500 text-white'
                  : 'bg-muted-foreground/15 text-muted-foreground group-data-[state=active]:bg-primary group-data-[state=active]:text-primary-foreground'
              }`}>
                {serviceTickets.length}
              </span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="quotes" className="mt-4 space-y-4">
          {/* Quotes */}
          <Card className="rounded-xl border-border shadow-card overflow-hidden">
            <CardHeader className="border-b border-border/50 bg-muted/50 py-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <FileText className="h-4 w-4 text-muted-foreground" />
                הצעות מחיר ({quotes.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {quotes.length === 0 ? (
                <div className="py-4 flex items-center justify-between gap-3 text-sm">
                  <span className="text-muted-foreground">אין הצעות מחיר לליד זה.</span>
                  <Button size="sm" variant="outline" onClick={() => setShowQuoteDialog(true)}>
                    <FileText className="h-3.5 w-3.5 me-1" />
                    צור הצעה
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {quotes.map((quote) =>
                    <Link
                      key={quote.id}
                      to={createPageUrl('QuoteDetails') + `?id=${quote.id}`}
                      className="block p-3 border rounded-lg hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium">#{quote.quote_number}</span>
                        <StatusBadge status={quote.status} />
                      </div>
                      <p className="text-lg font-bold text-primary">
                        ₪{quote.total?.toLocaleString()}
                      </p>
                    </Link>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          </TabsContent>

          {/* Orders — "has this person bought from us before?". Scoped to the
              contact, so a returning customer's previous order shows up here
              even though it hangs off the enquiry they placed it from. An
              order from another enquiry says so on its row. */}
          <TabsContent value="orders" className="mt-3">
            {contactOrders.length === 0 ? (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-3 py-2.5 text-sm">
                <span className="text-muted-foreground">אין הזמנות ללקוח הזה.</span>
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setShowOrderDialog(true)}>
                  <ShoppingBag className="h-3.5 w-3.5" />
                  הזמנה חדשה
                </Button>
              </div>
            ) : (
              /* A row per order, and the row says what they bought. The tab
                 already carries the count, so there's no card header repeating
                 it — a customer with five orders should read as five lines,
                 not five panels. */
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                {contactOrders.map((order) => {
                  const fromOtherEnquiry = order.lead_id && order.lead_id !== leadId;
                  const bought = summarizeOrderItems(order);
                  return (
                    <Link
                      key={order.id}
                      to={createPageUrl('OrderDetails') + `?id=${order.id}`}
                      className="flex items-center gap-2 px-3 py-2 border-t first:border-t-0 border-border/50 hover:bg-muted/50 transition-colors"
                    >
                      <span className="text-[13px] font-medium flex-shrink-0">#{order.order_number}</span>

                      <span
                        className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground"
                        title={bought || undefined}
                      >
                        {bought || '—'}
                      </span>

                      {fromOtherEnquiry ? (
                        <span
                          className="inline-flex items-center rounded px-1.5 h-[18px] text-[10px] font-medium bg-indigo-50 text-indigo-700 flex-shrink-0"
                          title="ההזמנה רשומה על פנייה אחרת של אותו אדם"
                        >
                          פנייה אחרת
                        </span>
                      ) : null}

                      {/* Only when there is one. An order with an empty status
                          rendered as a blank grey pill — a badge saying nothing. */}
                      {order.status ? <StatusBadge status={order.status} className="flex-shrink-0" /> : null}

                      <span className="text-[13px] font-bold text-primary tabular-nums flex-shrink-0">
                        ₪{order.total?.toLocaleString()}
                      </span>

                      {order.created_date ? (
                        <span className="text-[11px] text-muted-foreground tabular-nums flex-shrink-0">
                          {formatInTimeZone(order.created_date, 'Asia/Jerusalem', 'dd/MM/yyyy')}
                        </span>
                      ) : null}
                    </Link>
                  );
                })}
              </div>
            )}
          </TabsContent>

          {/* Service — its own tab now. It shares nothing with quotes except
              the customer, and pairing them meant a rep looking for one had
              to scroll past the other. The header alert badge scrolls to
              this section via the id below. */}
          <TabsContent value="service" className="mt-4 space-y-4">
          <Card id="lead-service-section" className="rounded-xl border-border shadow-card overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between border-b border-border/50 bg-muted/50">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Headphones className="h-4 w-4 text-muted-foreground" />
                שירות
                {openServiceTicketsCount > 0 ? (
                  <Badge variant="warning">{openServiceTicketsCount} פתוחות</Badge>
                ) : null}
              </CardTitle>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <ShoppingBag className="h-3.5 w-3.5" />
                  {linkedOrderIds.length} {linkedOrderIds.length === 1 ? 'הזמנה מקושרת' : 'הזמנות מקושרות'}
                </span>
              </div>
            </CardHeader>
            <CardContent className="p-4">
              {linkedOrderIds.length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-6">
                  ללקוח אין הזמנות פעילות, ולכן אין נתיב לפתיחת קריאת שירות מכאן.
                  קריאת שירות נפתחת תמיד מתוך הזמנה קיימת.
                </div>
              ) : serviceTickets.length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-6">
                  אין קריאות שירות פתוחות או היסטוריות עבור ההזמנות של הלקוח.
                </div>
              ) : (
                <div className="space-y-2">
                  {/* Open tickets first, then resolved/closed by recency.
                      Open ones get an amber tint so they pop visually
                      when a rep glances at this section. */}
                  {[...serviceTickets]
                    .sort((a, b) => {
                      const aOpen = !['resolved', 'closed'].includes(String(a.status || '').toLowerCase());
                      const bOpen = !['resolved', 'closed'].includes(String(b.status || '').toLowerCase());
                      if (aOpen !== bOpen) return aOpen ? -1 : 1;
                      return new Date(b.updated_date || b.created_date || 0) - new Date(a.updated_date || a.created_date || 0);
                    })
                    .map((ticket) => {
                      const isOpen = !['resolved', 'closed'].includes(String(ticket.status || '').toLowerCase());
                      return (
                        <Link
                          key={ticket.id}
                          to={createPageUrl('TicketDetails') + `?id=${ticket.id}`}
                          className={`block border rounded-lg p-3 transition-colors ${isOpen ? 'border-amber-200 bg-amber-50/40 hover:bg-amber-50' : 'border-border hover:bg-muted/40'}`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-foreground">
                              #{ticket.ticket_number || ticket.id?.slice(0, 6)}
                            </span>
                            <StatusBadge status={ticket.status} />
                          </div>
                          <p className="text-xs text-muted-foreground mt-1 truncate">{ticket.subject || 'פניית שירות'}</p>
                        </Link>
                      );
                    })}
                </div>
              )}
            </CardContent>
          </Card>
          </TabsContent>

        </Tabs>

      </LeadOverview>

      {/* Close a task straight from the next-task strip */}
      <CompleteTaskDialog
        isOpen={!!completingTask}
        task={completingTask}
        onClose={() => setCompletingTask(null)}
        onCompleted={() => {
          setCompletingTask(null);
          queryClient.invalidateQueries({ queryKey: ['tasks', leadId] });
          queryClient.invalidateQueries({ queryKey: ['lead', leadId] });
          queryClient.invalidateQueries({ queryKey: ['leadActivityLogs', leadId] });
        }}
      />

      {/* Add Communication Dialog */}
      <AddCommunication
        leadId={leadId}
        isOpen={showAddCommunication}
        onClose={() => setShowAddCommunication(false)} />

      {/* Add Task Dialog */}
      <SalesTaskDialog
        isOpen={showAddTaskDialog}
        onClose={() => setShowAddTaskDialog(false)}
        preSelectedLead={lead}
        effectiveUser={effectiveUser}
      />

      {/* Inline order creation — opens over the lead, no navigation away.
          On success we just close + refresh the lead's linked orders, so the
          rep stays on the lead they were working. */}
      <Dialog open={showOrderDialog} onOpenChange={setShowOrderDialog}>
        <DialogContent
          className="max-w-4xl max-h-[90vh] overflow-y-auto"
          dir="rtl"
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">הזמנה חדשה - {lead?.full_name || ''}</DialogTitle>
          </DialogHeader>
          <NewOrder
            asDialog
            dialogLeadId={leadId}
            onDialogClose={(order) => {
              setShowOrderDialog(false);
              // order is truthy only on a successful create (null = cancel),
              // so we refresh the lead's linked orders and confirm only then.
              if (order?.id) {
                queryClient.invalidateQueries({ queryKey: ['lead', leadId] });
                queryClient.invalidateQueries({ queryKey: ['leads'] });
                queryClient.invalidateQueries({ queryKey: ['orders'] });
                toast({ title: 'ההזמנה נוצרה' });
              }
            }}
          />
        </DialogContent>
      </Dialog>

      {/* Inline quote creation — prefilled from this lead's customer details.
          Local dialog (not useCreationModal) so it works inside the lead
          overlay, which sits above the CreationModal provider. */}
      <NewQuoteDialog
        open={showQuoteDialog}
        onOpenChange={setShowQuoteDialog}
        leadId={leadId}
        title={`הצעת מחיר חדשה - ${lead?.full_name || ''}`}
        onCreated={(quote) => {
          queryClient.invalidateQueries({ queryKey: ['lead', leadId] });
          queryClient.invalidateQueries({ queryKey: ['leads'] });
          queryClient.invalidateQueries({ queryKey: ['quotes'] });
          if (quote?.id) toast({ title: 'הצעת המחיר נוצרה' });
        }}
      />

      {/* Edit Task Dialog */}
      <SalesTaskDialog
        isOpen={showEditTaskDialog}
        onClose={() => { setShowEditTaskDialog(false); setEditingTask(null); }}
        task={editingTask ? { ...editingTask, lead } : null}
        effectiveUser={effectiveUser}
      />

      {/* Assign-before-task gate: blocks "משימה חדשה" on a lead that
          has no primary rep. Forces the user to pick an owner first
          (via the existing handleQuickAssignRep1 flow), then jumps
          straight into the task dialog so the original intent
          isn't lost. */}
      <Dialog open={showAssignBeforeTask} onOpenChange={(open) => { if (!open) setShowAssignBeforeTask(false); }}>
        <DialogContent dir="rtl" className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold">נדרש שיוך לפני פתיחת משימה</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="rounded-lg border border-amber-200 bg-amber-50 text-amber-900 text-sm px-3 py-2 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <span>לא ניתן לפתוח משימה לליד שלא משויך. בחר נציג ראשי לשיוך, והמשימה תיפתח מיד אחרי השיוך.</span>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">נציג ראשי</Label>
              <Select value={assignBeforeTaskRep} onValueChange={setAssignBeforeTaskRep}>
                <SelectTrigger className="h-10"><SelectValue placeholder="בחר נציג" /></SelectTrigger>
                <SelectContent>
                  {salesReps.map((rep) => (
                    <RepSelectItem key={rep.id} rep={rep} />
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => setShowAssignBeforeTask(false)} disabled={isAssigningBeforeTask}>ביטול</Button>
              <Button onClick={confirmAssignThenAddTask} disabled={!assignBeforeTaskRep || isAssigningBeforeTask}>
                {isAssigningBeforeTask ? 'משייך…' : 'שייך ופתח משימה'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>


    </>);

}