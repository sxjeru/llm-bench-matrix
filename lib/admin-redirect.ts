const ADMIN_HOME = "/admin";
const ADMIN_LOGIN_PATH = "/admin/login";

/**
 * Only allow same-origin /admin* destinations, never the login page itself.
 */
export function sanitizeAdminRedirectTarget(
  rawTarget: string | null | undefined,
  origin = "http://localhost"
): string {
  if (!rawTarget) return ADMIN_HOME;

  const target = rawTarget.trim();
  if (!target.startsWith("/") || target.startsWith("//")) return ADMIN_HOME;

  try {
    const baseOrigin = new URL(origin).origin;
    const resolved = new URL(target, baseOrigin);
    if (resolved.origin !== baseOrigin) return ADMIN_HOME;
    if (!resolved.pathname.startsWith(ADMIN_HOME)) return ADMIN_HOME;
    if (
      resolved.pathname === ADMIN_LOGIN_PATH ||
      resolved.pathname.startsWith(`${ADMIN_LOGIN_PATH}/`)
    ) {
      return ADMIN_HOME;
    }

    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return ADMIN_HOME;
  }
}
