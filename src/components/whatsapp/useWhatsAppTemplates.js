import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';

// Active WhatsApp templates, shared by the composer's "/" shortcut expansion
// and its template-browser popover. High staleTime — templates change rarely
// (admin-managed) and every rep's composer mounts this on every chat open.
export function useWhatsAppTemplates() {
  return useQuery({
    queryKey: ['wa-templates'],
    queryFn: () => base44.entities.WhatsAppTemplate.filter({ is_active: true }, 'sort_order'),
    staleTime: 10 * 60 * 1000,
  });
}
