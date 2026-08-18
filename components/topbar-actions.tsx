"use client";

import Link from "next/link";
import { LogOut, ScatterChart, Shield, Table2 } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { HOME_PATH, SCATTER_PATH, isHomePath, isScatterPath } from "@/lib/public-routes";

const PAGE_LINKS = [
  { href: HOME_PATH, label: "矩阵", icon: Table2, isActive: isHomePath },
  { href: SCATTER_PATH, label: "散点图", icon: ScatterChart, isActive: isScatterPath }
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
          {PAGE_LINKS.map(({ href, label, icon: Icon, isActive }) => {
            // 用与 keep-alive 同一套路由判定，/scatter/xxx 这类嵌套路径也算命中
            const active = isActive(pathname);

            return (
              <Link
                key={href}
                href={href}
                prefetch={false}
                className={`nav-link ${active ? "is-active" : ""}`}
                aria-current={active ? "page" : undefined}
                suppressHydrationWarning
              >
                <Icon size={15} />
                <span>{label}</span>
              </Link>
            );
          })}
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

      {/*
        prefetch 关掉：target="_blank" 的跳转走浏览器原生导航，预取来的 RSC 载荷
        根本不会被消费，代价却是每次首页加载都让服务端渲染一遍后台页——那里有
        getActiveEntities 等一批全表查询，会和公开接口抢连接池与事件循环。
      */}
      <Link
        href="/admin"
        prefetch={false}
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
