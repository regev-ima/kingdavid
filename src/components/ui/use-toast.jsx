// Compatibility shim over sonner.
//
// The app historically had two toast systems: this shadcn-style `useToast`
// (a plain-<div> reimplementation that never auto-dismissed — its close
// button was even a no-op, so toasts got stuck on screen) and sonner, which
// auto-dismisses and is far more visual. Everything now routes through
// sonner, so the handful of screens still calling `useToast({ title,
// description, variant })` keep working unchanged — they just get sonner's
// auto-dismissing, colored toasts for free.
import { toast as sonnerToast } from 'sonner';

function toast({ title, description, variant, duration } = {}) {
  const opts = {};
  if (description) opts.description = description;
  if (duration != null) opts.duration = duration;

  // default variant → success (these calls are overwhelmingly confirmations);
  // destructive → error. Anything richer should call sonner directly.
  const id = variant === 'destructive'
    ? sonnerToast.error(title, opts)
    : sonnerToast.success(title, opts);

  return {
    id,
    dismiss: () => sonnerToast.dismiss(id),
    update: () => {},
  };
}

function useToast() {
  return {
    // Kept for API compatibility; sonner owns rendering now, so there are
    // no toasts to hand back to a custom <Toaster>.
    toasts: [],
    toast,
    dismiss: (id) => sonnerToast.dismiss(id),
  };
}

export { useToast, toast };
