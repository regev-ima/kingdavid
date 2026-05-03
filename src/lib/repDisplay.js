// Single source of truth for rendering a rep's name in the UI. Centralized
// here because half the pages used to ship `email.split('@')[0]` as the
// fallback — which means whenever a rep wasn't in the local users list, the
// app showed `yonikingdavid` instead of `יוני שמש`. Falling back to the full
// email is more useful for debugging than the stripped local-part, and the
// admin can fix the underlying user record once they see which email it is.

export function getRepDisplayName(email, users = []) {
  if (!email) return '';
  const list = Array.isArray(users) ? users : [];
  const user = list.find((u) => u?.email && u.email.toLowerCase() === email.toLowerCase());
  return user?.full_name || email;
}
