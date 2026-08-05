/**
 * Which permission gates which page.
 *
 * This is the map that turns the permissions system from a menu filter into
 * actual access control. Hiding a sidebar entry decides nothing: every page in
 * this app is a route, and a route is reachable by typing the URL, by the logo
 * link in the header, by a bookmark, or by any deep link in a notification.
 * The guard in Layout uses this map to refuse to RENDER a blocked page, which
 * is the part a user cannot walk around.
 *
 * Detail and creation screens map to their area's permission, so blocking
 * "גישה להזמנות" also blocks the order detail page somebody was linked to —
 * otherwise the block leaks through the first shared URL.
 *
 * Pages deliberately absent (no entry = never blocked here):
 *   • HypReturn, ServiceRequestPublic — public, rendered outside the auth gate.
 *   • Login — obviously.
 * A page missing from this map is simply not gated by the permissions system;
 * whatever guard it already had still applies.
 */
export const PAGE_PERMISSIONS = {
  // ── Dashboards ──
  Dashboard2: 'dashboards.control_center',
  SalesDashboard: 'dashboards.sales',
  FactoryDashboard: 'dashboards.factory',

  // ── Leads ──
  LeadManagement: 'leads.view',
  Leads: 'leads.view', // legacy alias route
  LeadDetails: 'leads.view',
  NewLead: 'leads.create',
  LeadLookup: 'leads.lookup',

  // ── Tasks ──
  SalesTasks: 'tasks.view',

  // ── Customers ──
  Customers: 'customers.view',
  CustomerDetails: 'customers.view',

  // ── Quotes ──
  Quotes: 'quotes.view',
  QuoteDetails: 'quotes.view',
  NewQuote: 'quotes.create',
  EditQuote: 'quotes.edit',

  // ── Orders ──
  Orders: 'orders.view',
  OrderDetails: 'orders.view',
  NewOrder: 'orders.create',
  ExtraCharges: 'orders.extra_charges',

  // ── Money ──
  Finance: 'finance.view',
  Bookkeeping: 'finance.bookkeeping',

  // ── Marketing ──
  Marketing: 'marketing.view',
  LandingPages: 'marketing.landing_pages',
  ClubSignups: 'marketing.club_signups',

  // ── Production & logistics ──
  Factory: 'factory.view',
  Deliveries: 'logistics.view',
  ShipmentDetails: 'logistics.view',
  Inventory: 'inventory.view',
  ProductsNew: 'catalog.view',

  // ── Service ──
  ServiceCenter: 'service.manage',
  ServiceRequestDetails: 'service.view',
  TicketDetails: 'service.view',
  Returns: 'service.returns',
  ReturnDetails: 'service.returns',
  NewReturn: 'service.returns',

  // ── Communication ──
  WhatsAppChat: 'comms.whatsapp',
  CallAnalytics: 'comms.call_analytics',

  // ── Reports ──
  OperationalReports: 'reports.operational',

  // ── Team & schedule ──
  Representatives: 'settings.users',
  Schedule: 'team.shift_schedule',

  // ── Settings ──
  Settings: 'settings.access',
  NotificationSettings: 'settings.profile',
  BulkUpdate: 'settings.bulk',
};

/** The permission gating `pageName`, or null when the page is not gated. */
export function permissionForPage(pageName) {
  return PAGE_PERMISSIONS[pageName] || null;
}

/**
 * Where to send somebody who lands on a page they may not open.
 *
 * Not a hard-coded home: the fallback has to be a page they can actually
 * reach, or the redirect bounces. Callers pass a predicate so this stays free
 * of any dependency on how "allowed" is decided.
 */
export const FALLBACK_PAGES = [
  'LeadManagement',
  'Orders',
  'FactoryDashboard',
  'Bookkeeping',
  'Settings',
];

export function firstReachablePage(isAllowed) {
  return FALLBACK_PAGES.find((page) => isAllowed(PAGE_PERMISSIONS[page])) || 'Settings';
}
