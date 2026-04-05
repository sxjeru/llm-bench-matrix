"use client";

import Link from "next/link";
import { LogOut, Shield } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

export function TopbarActions() {
  const pathname = usePathname();
  const router = useRouter();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const showLogout = pathname.startsWith("/admin") && pathname !== "/admin/login";

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

      <Link href="/admin" className="nav-icon" aria-label="后台管理">
        <Shield size={18} />
      </Link>
    </nav>
  );
}
