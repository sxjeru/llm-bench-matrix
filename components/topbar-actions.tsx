"use client";

import Link from "next/link";
import { LogOut, ScatterChart, Shield, Table2 } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

const PAGE_LINKS = [
  { href: "/", label: "矩阵", icon: Table2 },
  { href: "/scatter", label: "散点图", icon: ScatterChart }
] as const;

export function TopbarActions() {
  const pathname = usePathname();
  const router = useRouter();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const showLogout = pathname.startsWith("/admin") && pathname !== "/admin/login";
  const isAdminArea = pathname.startsWith("/admin");

  async function handleLogout() {
    if (isLoggingOut) return;

    setIsLoggingOut(true);
    try {
      await fetch("/api/admin/logout", { method: "POST" });
      router.push("/admin/login");
      router.refresh();
    } finally {
      setIsLoggingOut(false);
    }
  }

  return (
    <nav className="nav">
      {isAdminArea ? null : (
        <div className="nav-links">
          {PAGE_LINKS.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={`nav-link ${pathname === href ? "is-active" : ""}`}
              aria-current={pathname === href ? "page" : undefined}
              suppressHydrationWarning
            >
              <Icon size={15} />
              <span>{label}</span>
            </Link>
          ))}
        </div>
      )}

      {showLogout ? (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={handleLogout}
          disabled={isLoggingOut}
          aria-label="退出登录"
        >
          <LogOut size={16} />
          {isLoggingOut ? "退出中..." : "退出登录"}
        </button>
      ) : null}

      <Link
        href="/admin"
        className="nav-icon"
        aria-label="后台管理"
        target="_blank"
        rel="noopener noreferrer"
        suppressHydrationWarning
      >
        <Shield size={18} />
      </Link>
    </nav>
  );
}
