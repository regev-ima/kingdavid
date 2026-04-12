import { base44 } from '@/api/base44Client';

export async function createAuditLog({ leadId, actionType, description, user, fieldName, oldValue, newValue, metadata }) {
  try {
    return await base44.entities.LeadActivityLog.create({
      lead_id: leadId,
      action_type: actionType,
      action_description: description,
      performed_by: user?.email || 'system',
      performed_by_name: user?.full_name || user?.email || 'מערכת',
      field_name: fieldName || null,
      old_value: oldValue != null ? String(oldValue) : null,
      new_value: newValue != null ? String(newValue) : null,
      metadata: metadata || null,
    });
  } catch (error) {
    console.error('Failed to create audit log:', error);
  }
}
