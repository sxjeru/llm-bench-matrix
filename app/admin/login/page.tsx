import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isAdminAuthorized } from "@/lib/admin-auth";
import { sanitizeAdminRedirectTarget } from "@/lib/admin-redirect";
import { AdminLoginForm } from "./login-form";

export default async function AdminLoginPage({
  searchParams
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const headerStore = await headers();
  const cookie = headerStore.get("cookie") ?? "";
  const authRequest = new Request("http://localhost/admin/login", {
    headers: cookie ? { cookie } : {}
  });

  const authorized = await isAdminAuthorized(authRequest);
  if (authorized) {
    const resolvedSearchParams = await searchParams;
    const host = headerStore.get("x-forwarded-host") ?? headerStore.get("host") ?? "localhost";
    const proto = headerStore.get("x-forwarded-proto") ?? "http";
    const origin = `${proto}://${host}`;
    redirect(sanitizeAdminRedirectTarget(resolvedSearchParams.from, origin));
  }

  return <AdminLoginForm />;
}
