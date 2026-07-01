export const USER_SCOPES = {
  ADMIN: 'admin',
  SALES: 'sales_user',
  FACTORY: 'factory_user',
  // מנהלת חשבונות: narrow scope that only sees the invoicing area
  // (orders waiting for / with an issued invoice). Detected via
  // `role === 'bookkeeper'` OR `department === 'bookkeeping'` so
  // existing user records can be flagged either way.
  BOOKKEEPER: 'bookkeeper',
  ANON: 'anonymous',
};

// ── Grantable per-rep permissions ───────────────────────────────────────
// Extra capabilities an admin can switch on for an individual rep, on top of
// whatever their role already grants. Stored in `users.extra_permissions`
// (jsonb object, e.g. { "view_finance": true }) and managed from the
// "נהל נציג" → הרשאות tab. Each key below is wired into a real gate (see the
// helpers further down), so toggling it actually changes what the rep can do.
export const GRANTABLE_PERMISSIONS = [
  {
    key: 'manage_service',
    label: 'ניהול מרכז שירות',
    description: 'הקצאת פניות שירות לכל נציג והרצת ייבוא — לא רק פתיחת פנייה.',
  },
  {
    key: 'view_finance',
    label: 'צפייה באזור פיננסי',
    description: 'גישה לדשבורד הפיננסי ולנתוני הכנסות/חשבוניות.',
  },
  {
    key: 'bulk_update',
    label: 'עדכון מרוכז',
    description: 'שימוש בכלי העדכון המרוכז (Bulk Update) לעריכת לידים בכמות.',
  },
  {
    key: 'edit_schedule',
    label: 'עריכת שיבוץ משמרות',
    description: 'שיבוץ נציגים למשמרות בעמוד "שיבוץ משמרות". שאר הנציגים רק צופים.',
  },
];

// True when `key` is switched on in the rep's extra_permissions blob.
// Admins implicitly have every grantable permission.
export function hasExtraPermission(user, key) {
  if (!user) return false;
  if (isAdmin(user)) return true;
  return user.extra_permissions?.[key] === true;
}

export function getUserScope(user) {
  if (!user) return USER_SCOPES.ANON;
  if (user.role === 'admin') return USER_SCOPES.ADMIN;
  if (user.department === 'factory' || user.role === 'factory_user') return USER_SCOPES.FACTORY;
  if (user.department === 'bookkeeping' || user.role === 'bookkeeper') return USER_SCOPES.BOOKKEEPER;
  return USER_SCOPES.SALES;
}

export function isAdmin(user) {
  return getUserScope(user) === USER_SCOPES.ADMIN;
}

export function isSalesUser(user) {
  return getUserScope(user) === USER_SCOPES.SALES;
}

export function isFactoryUser(user) {
  return getUserScope(user) === USER_SCOPES.FACTORY;
}

export function isBookkeeperUser(user) {
  return getUserScope(user) === USER_SCOPES.BOOKKEEPER;
}

export function canAccessSalesWorkspace(user) {
  return isAdmin(user) || isSalesUser(user);
}

export function canAccessFactoryWorkspace(user) {
  return isAdmin(user) || isFactoryUser(user);
}

export function canAccessBookkeepingWorkspace(user) {
  return isAdmin(user) || isBookkeeperUser(user);
}

// Pages the bookkeeper needs read-access to so she can chase invoices —
// orders, quotes, and the finance dashboard. Sales reps + admin keep
// their existing access; bookkeeper is added on top.
export function canViewOrdersWorkspace(user) {
  return canAccessSalesWorkspace(user) || isBookkeeperUser(user);
}

export function canViewFinanceWorkspace(user) {
  return isAdmin(user) || isBookkeeperUser(user) || hasExtraPermission(user, 'view_finance');
}

// Grantable access to the Bulk Update tool. Admins always; otherwise the
// `bulk_update` extra permission opens it for a specific rep.
export function canUseBulkUpdate(user) {
  return isAdmin(user) || hasExtraPermission(user, 'bulk_update');
}

// Shift schedule ("שיבוץ משמרות"). Everyone authenticated can VIEW the weekly
// board; admins — or a rep granted `edit_schedule` — may assign reps to shifts.
export function canEditSchedule(user) {
  return isAdmin(user) || hasExtraPermission(user, 'edit_schedule');
}

export function canAccessSupportWorkspace(user) {
  return isAdmin(user) || isFactoryUser(user) || isSalesUser(user);
}

export function canAccessReturnsWorkspace(user) {
  return canAccessSupportWorkspace(user);
}

// ── Service Center (מרכז שירות) ──────────────────────────────────────────
// Every sales/factory/admin user can OPEN a service ticket for any order, but
// opening a ticket never lets them edit the order itself (that stays gated by
// canViewOrder / the order edit screens). This mirrors the brief: "כל נציג
// יכול לפתוח פניית שירות... אבל לא רשאי לערוך את ההזמנה".
export function canAccessServiceWorkspace(user) {
  return canAccessSupportWorkspace(user);
}

export function canOpenServiceTicket(user) {
  return canAccessSupportWorkspace(user);
}

// A grantable permission (users.can_manage_service) for the person who runs
// the service desk — they can assign a service task to ANY rep and run the
// imports. Admins always have it.
export function canManageService(user) {
  if (!user) return false;
  return isAdmin(user) || user.can_manage_service === true || hasExtraPermission(user, 'manage_service');
}

// Assigning a service follow-up task to a rep is a manager action.
export function canAssignServiceTask(user) {
  return canManageService(user);
}

export function canAccessAdminOnly(user) {
  return isAdmin(user);
}

function normalized(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function normalizedIdentifierCandidates(value) {
  if (!value) return [];

  if (Array.isArray(value)) {
    return value.flatMap((item) => normalizedIdentifierCandidates(item));
  }

  if (typeof value === 'string') {
    const normalizedValue = normalized(value);
    if (!normalizedValue) return [];

    const localPart = normalizedValue.includes('@') ? normalizedValue.split('@')[0] : '';
    const compact = normalizedValue.replace(/\s+/g, '');
    return [normalizedValue, localPart, compact].filter(Boolean);
  }

  if (typeof value === 'object') {
    return [
      ...normalizedIdentifierCandidates(value.email),
      ...normalizedIdentifierCandidates(value.id),
      ...normalizedIdentifierCandidates(value.full_name),
      ...normalizedIdentifierCandidates(value.name),
      ...normalizedIdentifierCandidates(value.username),
    ];
  }

  return [];
}

export function matchesUserIdentifier(user, ...values) {
  const userCandidates = new Set([
    ...normalizedIdentifierCandidates(user?.email),
    ...normalizedIdentifierCandidates(user?.id),
    ...normalizedIdentifierCandidates(user?.full_name),
    ...normalizedIdentifierCandidates(user?.name),
  ]);

  return values.some((value) => {
    const candidates = normalizedIdentifierCandidates(value);
    return candidates.some((candidate) => userCandidates.has(candidate));
  });
}

export function canViewLead(user, lead) {
  if (!lead || !canAccessSalesWorkspace(user)) return false;
  if (isAdmin(user)) return true;
  return matchesUserIdentifier(user, lead.rep1, lead.rep2, lead.pending_rep_email);
}

export function filterLeadsForUser(user, leads = []) {
  return leads.filter((lead) => canViewLead(user, lead));
}

export function canViewSalesTask(user, task) {
  if (!task || !canAccessSalesWorkspace(user)) return false;
  if (isAdmin(user)) return true;

  if (
    matchesUserIdentifier(
      user,
      task.rep1,
      task.rep2,
      task.pending_rep_email,
      task.assigned_to,
      task.owner
    )
  ) {
    return true;
  }
  return false;
}

export function filterSalesTasksForUser(user, tasks = [], leadsById = {}) {
  return tasks.filter((task) => {
    if (!task) return false;
    if (canViewSalesTask(user, task)) return true;

    const hasExplicitOwnership = Boolean(
      normalized(task.rep1) ||
      normalized(task.rep2) ||
      normalized(task.pending_rep_email) ||
      normalized(task.assigned_to) ||
      normalized(task.owner)
    );

    if (hasExplicitOwnership || !task.lead_id) return false;

    const lead = leadsById[task.lead_id];
    return lead ? canViewLead(user, lead) : false;
  });
}

export function canViewOrder(user, order) {
  if (!order) return false;
  if (isAdmin(user) || isFactoryUser(user) || isBookkeeperUser(user)) return true;
  if (!isSalesUser(user)) return false;
  return matchesUserIdentifier(user, order.rep1, order.rep2);
}

export function filterOrdersForUser(user, orders = []) {
  return orders.filter((order) => canViewOrder(user, order));
}

export function canViewQuote(user, quote, leadsById = {}) {
  if (!quote) return false;
  if (isAdmin(user) || isBookkeeperUser(user)) return true;
  if (!canAccessSalesWorkspace(user)) return false;
  if (matchesUserIdentifier(user, quote.created_by_rep)) return true;

  const lead = quote.lead_id ? leadsById[quote.lead_id] : null;
  return lead ? canViewLead(user, lead) : false;
}

export function filterQuotesForUser(user, quotes = [], leadsById = {}) {
  return quotes.filter((quote) => canViewQuote(user, quote, leadsById));
}

export function buildOrdersByCustomerId(orders = []) {
  return orders.reduce((acc, order) => {
    if (!order.customer_id) return acc;
    if (!acc[order.customer_id]) acc[order.customer_id] = [];
    acc[order.customer_id].push(order);
    return acc;
  }, {});
}

export function buildLeadsById(leads = []) {
  return leads.reduce((acc, lead) => {
    if (lead?.id) acc[lead.id] = lead;
    return acc;
  }, {});
}

export function canViewCustomer(user, customer, context = {}) {
  if (!customer || !canAccessSalesWorkspace(user)) return false;
  if (isAdmin(user)) return true;

  const { leadsById = {}, ordersByCustomerId = {} } = context;
  if (matchesUserIdentifier(user, customer.account_manager, customer.rep2, customer.pending_rep_email)) return true;

  const lead = customer.lead_id ? leadsById[customer.lead_id] : null;
  if (lead && canViewLead(user, lead)) return true;

  const customerOrders = ordersByCustomerId[customer.id] || [];
  return customerOrders.some((order) => canViewOrder(user, order));
}

export function filterCustomersForUser(user, customers = [], context = {}) {
  return customers.filter((customer) => canViewCustomer(user, customer, context));
}

export function canViewSupportTicket(user, ticket) {
  if (!ticket || !canAccessSupportWorkspace(user)) return false;
  if (isAdmin(user) || isFactoryUser(user)) return true;
  return matchesUserIdentifier(user, ticket.assigned_to);
}

export function filterTicketsForUser(user, tickets = []) {
  return tickets.filter((ticket) => canViewSupportTicket(user, ticket));
}

export function canViewReturnRequest(user, returnRequest) {
  if (!returnRequest) return false;
  return canAccessReturnsWorkspace(user);
}

export function filterReturnsForUser(user, returnRequests = []) {
  return returnRequests.filter((returnRequest) => canViewReturnRequest(user, returnRequest));
}

// Rep editing permissions — shared across Lead & Customer (and any other entity
// with a primary/secondary rep pattern).
// Primary rep (rep1 / account_manager) is the ownership assignment: admin-only.
// Secondary rep (rep2) can be set once by a sales user while the slot is empty;
// changing an already-set value is admin-only.
export function canEditPrimaryRep(user) {
  return isAdmin(user);
}

export function canEditSecondaryRep(user, entity) {
  if (isAdmin(user)) return true;
  if (!isSalesUser(user)) return false;
  return !entity?.rep2;
}