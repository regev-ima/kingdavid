import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { userId, type, title, message, link, linkLabel, priority, entityType, entityId } = await req.json();

    if (!userId || !type || !title || !message) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Check user preferences before creating notification
    const preferences = await base44.asServiceRole.entities.NotificationPreferences.filter({ user_id: userId });
    
    if (preferences.length > 0) {
      const prefs = preferences[0];
      
      // Map notification type to preference field
      const prefMap = {
        'task_due_soon': 'task_reminders',
        'task_overdue': 'task_reminders',
        'sla_breach': 'sla_alerts',
        'low_inventory': 'inventory_alerts',
        'new_support_ticket': 'support_ticket_alerts',
        'order_status_change': 'order_status_alerts',
        'new_lead_assigned': 'new_lead_alerts',
        'quote_expiring': 'quote_expiring_alerts',
        'return_request': 'return_request_alerts',
      };
      
      const prefField = prefMap[type];
      if (prefField && !prefs[prefField]) {
        return Response.json({ 
          success: true, 
          message: 'Notification skipped - user preference disabled',
          created: false 
        });
      }
    }

    // Create notification
    const notification = await base44.asServiceRole.entities.Notification.create({
      user_id: userId,
      type,
      title,
      message,
      link,
      link_label: linkLabel,
      priority: priority || 'medium',
      entity_type: entityType,
      entity_id: entityId,
      is_read: false
    });

    return Response.json({ success: true, notification, created: true });
  } catch (error) {
    console.error('Error creating notification:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});