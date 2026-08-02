"use client";

import type { TabKey } from "../types";

type AdminConsoleTabNavProps = {
  activeTab: TabKey;
  onTabChange: (tab: TabKey) => void;
};

export function AdminConsoleTabNav({ activeTab, onTabChange }: AdminConsoleTabNavProps) {
  const tabClass = (key: TabKey) =>
    `btn rounded-xl border-0 text-base md:text-base transition-all duration-200 ease-out ${
      activeTab === key
        ? "bg-primary text-primary-content font-semibold shadow-md"
        : "bg-transparent text-base-content/70 hover:bg-base-100/70 hover:text-base-content"
    }`;

  return (
    <div
      role="tablist"
      className="flex w-full flex-wrap items-center gap-1 rounded-2xl border border-base-300/70 bg-base-200/70 p-1.5 shadow-inner backdrop-blur"
    >
      <button
        type="button"
        role="tab"
        aria-selected={activeTab === "import"}
        className={tabClass("import")}
        onClick={() => onTabChange("import")}
      >
        导入中心
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={activeTab === "external"}
        className={tabClass("external")}
        onClick={() => onTabChange("external")}
      >
        外部数据源
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={activeTab === "entry"}
        className={tabClass("entry")}
        onClick={() => onTabChange("entry")}
      >
        数据录入
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={activeTab === "providers"}
        className={tabClass("providers")}
        onClick={() => onTabChange("providers")}
      >
        Provider 配置
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={activeTab === "pricing"}
        className={tabClass("pricing")}
        onClick={() => onTabChange("pricing")}
      >
        价格管理
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={activeTab === "params"}
        className={tabClass("params")}
        onClick={() => onTabChange("params")}
      >
        模型参数
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={activeTab === "rename"}
        className={tabClass("rename")}
        onClick={() => onTabChange("rename")}
      >
        名称维护
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={activeTab === "merge"}
        className={tabClass("merge")}
        onClick={() => onTabChange("merge")}
      >
        实体去重
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={activeTab === "maintenance"}
        className={tabClass("maintenance")}
        onClick={() => onTabChange("maintenance")}
      >
        数据维护
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={activeTab === "settings"}
        className={tabClass("settings")}
        onClick={() => onTabChange("settings")}
      >
        数据库设置
      </button>
    </div>
  );
}
