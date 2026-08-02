const ADMIN_HOME = "/admin";
const ADMIN_LOGIN_PATH = "/admin/login";

/**
 * Only allow same-origin /admin or /admin/... destinations, never the login page itself.
 * Uses exact/subpath checks so /administrator or /admin-test are rejected.
 * Accepts unknown because Next searchParams may yield string[] for duplicate keys.
 */
export function sanitizeAdminRedirectTarget(
  rawTarget: unknown,
  origin = "http://localhost"
): string {
  if (typeof rawTarget !== "string") return ADMIN_HOME;

  const target = rawTarget.trim();
  if (!target || !target.startsWith("/") || target.startsWith("//")) return ADMIN_HOME;

  try {
    const baseOrigin = new URL(origin).origin;
    const resolved = new URL(target, baseOrigin);
    if (resolved.origin !== baseOrigin) return ADMIN_HOME;

    const isExactOrSubpath =
      resolved.pathname === ADMIN_HOME || resolved.pathname.startsWith(`${ADMIN_HOME}/`);
    if (!isExactOrSubpath) return ADMIN_HOME;

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
