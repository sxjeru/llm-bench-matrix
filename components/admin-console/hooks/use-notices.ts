import { useEffect, useRef, useState } from "react";
import type { NoticeItem, NoticeState } from "../types";

export function useAdminNotices() {
  const [noticeList, setNoticeList] = useState<NoticeItem[]>([]);
  const noticeTimersRef = useRef<
    Map<number, { hideTimer: ReturnType<typeof setTimeout>; clearTimer: ReturnType<typeof setTimeout> }>
  >(new Map());
  const nextNoticeIdRef = useRef(1);

  useEffect(() => {
    const noticeTimers = noticeTimersRef.current;

    return () => {
      noticeTimers.forEach(({ hideTimer, clearTimer }) => {
        clearTimeout(hideTimer);
        clearTimeout(clearTimer);
      });
      noticeTimers.clear();
    };
  }, []);

  function clearNoticeTimers(noticeId: number) {
    const timers = noticeTimersRef.current.get(noticeId);
    if (!timers) return;

    clearTimeout(timers.hideTimer);
    clearTimeout(timers.clearTimer);
    noticeTimersRef.current.delete(noticeId);
  }

  function enqueueNotice(type: NoticeState["type"], message: string, details?: string[]) {
    const noticeId = nextNoticeIdRef.current;
    nextNoticeIdRef.current += 1;

    const normalizedDetails = details && details.length > 0 ? details : undefined;

    setNoticeList((prev) => [
      ...prev,
      {
        id: noticeId,
        type,
        message,
        details: normalizedDetails,
        visible: false
      }
    ]);

    window.requestAnimationFrame(() => {
      setNoticeList((prev) =>
        prev.map((item) =>
          item.id === noticeId
            ? {
                ...item,
                visible: true
              }
            : item
        )
      );
    });

    const hideDelay = type === "error" ? 30000 : 15000;
    const clearDelay = hideDelay + 500;

    const hideTimer = setTimeout(() => {
      setNoticeList((prev) =>
        prev.map((item) =>
          item.id === noticeId
            ? {
                ...item,
                visible: false
              }
            : item
        )
      );
    }, hideDelay);

    const clearTimer = setTimeout(() => {
      setNoticeList((prev) => prev.filter((item) => item.id !== noticeId));
      clearNoticeTimers(noticeId);
    }, clearDelay);

    noticeTimersRef.current.set(noticeId, { hideTimer, clearTimer });
  }

  function notifySuccess(message: string, details?: string[]) {
    enqueueNotice("success", message, details);
  }

  function notifyError(message: string, details?: string[]) {
    enqueueNotice("error", message, details);
  }

  return {
    noticeList,
    notifySuccess,
    notifyError
  };
}
