import { createServiceClient, corsHeaders, getUser } from '../_shared/supabase.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const user = await getUser(req);
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

  try {
    const supabase = createServiceClient();
    const { userId, type, title, message, link, linkLabel, priority, entityType, entityId } = await req.json();

    if (!userId || !type || !title || !message) {
      return Response.json({ error: 'Missing required fields' }, { status: 400, headers: corsHeaders });
    }

    // Check user preferences before creating notification
    const { data: preferences } = await supabase
      .from('notification_preferences')
      .select('*')
      .eq('user_id', userId);

    if (preferences && preferences.length > 0) {
      const prefs = preferences[0];

      // Map notification type to preference field
      const prefMap: Record<string, string> = {
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
          created: false,
        }, { headers: corsHeaders });
      }
    }

    // Create notification
    const { data: notification, error } = await supabase
      .from('notifications')
      .insert({
        user_id: userId,
        type,
        title,
        message,
        link,
        link_label: linkLabel,
        priority: priority || 'medium',
        entity_type: entityType,
        entity_id: entityId,
        is_read: false,
      })
      .select()
      .single();

    if (error) throw error;

    return Response.json({ success: true, notification, created: true }, { headers: corsHeaders });
  } catch (error) {
    console.error('Error creating notification:', error);
    return Response.json({ error: error.message }, { status: 500, headers: corsHeaders });
  }
});
