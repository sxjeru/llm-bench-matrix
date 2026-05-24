"use client";

import { Check, TriangleAlert } from "lucide-react";
import type { NoticeItem } from "../types";

type AdminConsoleNoticesProps = {
  noticeList: NoticeItem[];
};

export function AdminConsoleNotices({ noticeList }: AdminConsoleNoticesProps) {
  if (noticeList.length === 0) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed right-6 top-20 z-[120] flex flex-col items-end gap-3">
      {noticeList.map((notice) => (
        <div
          key={notice.id}
          className={`pointer-events-auto flex w-[360px] max-w-[90vw] items-start gap-3.5 rounded-2xl border p-4 shadow-[0_8px_30px_rgb(0,0,0,0.12)] backdrop-blur-2xl transition-all duration-400 ease-out ${
            notice.visible ? "translate-y-0 opacity-100 scale-100" : "-translate-y-4 opacity-0 scale-95"
          } ${
            notice.type === "success" 
              ? "border-emerald-500/30 bg-emerald-900/95 text-emerald-50 shadow-emerald-950/30" 
              : "border-rose-500/30 bg-rose-900/95 text-rose-50 shadow-rose-950/30"
          }`}
        >
          <div
            className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
              notice.type === "success" 
                ? "bg-emerald-500/30 text-emerald-100" 
                : "bg-rose-500/30 text-rose-100"
            }`}
          >
            {notice.type === "success" ? <Check size={14} strokeWidth={3} /> : <TriangleAlert size={14} strokeWidth={3} />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-semibold tracking-wide">{notice.message}</div>
            {notice.details && notice.details.length > 0 ? (
              <div className={`mt-1.5 flex flex-col gap-1.5 text-[13px] leading-relaxed ${
                notice.type === "success" ? "text-emerald-100/80" : "text-rose-100/80"
              }`}>
                {notice.details.map((detail, index) => (
                  <p key={`notice-detail-${notice.id}-${index}`} className="break-words">
                    {detail}
                  </p>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
