import { useCallback, useEffect, useRef, useState } from "react";
import type { NoticeItem, NoticeState } from "../types";

export function useAdminNotices() {
  const [noticeList, setNoticeList] = useState<NoticeItem[]>([]);
  const noticeTimersRef = useRef<
    Map<
      number,
      {
        type: NoticeState["type"];
        dismissing?: boolean;
        hideTimer?: ReturnType<typeof setTimeout>;
        clearTimer?: ReturnType<typeof setTimeout>;
      }
    >
  >(new Map());
  const nextNoticeIdRef = useRef(1);

  const clearNoticeTimers = useCallback((noticeId: number, deleteRecord = true) => {
    const record = noticeTimersRef.current.get(noticeId);
    if (!record) return;

    if (record.hideTimer) clearTimeout(record.hideTimer);
    if (record.clearTimer) clearTimeout(record.clearTimer);

    if (deleteRecord) {
      noticeTimersRef.current.delete(noticeId);
    } else {
      record.hideTimer = undefined;
      record.clearTimer = undefined;
    }
  }, []);

  useEffect(() => {
    const noticeTimers = noticeTimersRef.current;

    return () => {
      noticeTimers.forEach((record) => {
        if (record.hideTimer) clearTimeout(record.hideTimer);
        if (record.clearTimer) clearTimeout(record.clearTimer);
      });
      noticeTimers.clear();
    };
  }, []);

  const scheduleNoticeDismiss = useCallback(
    (noticeId: number, type: NoticeState["type"]) => {
      clearNoticeTimers(noticeId, false);

      const hideDelay = type === "error" ? 30000 : 15000;

      const hideTimer = setTimeout(() => {
        setNoticeList((prev) =>
          prev.map((item) =>
            item.id === noticeId
              ? {
                  ...item,
                  visible: false,
                  dismissing: true
                }
              : item
          )
        );

        const currentRecord = noticeTimersRef.current.get(noticeId);
        if (currentRecord) {
          currentRecord.dismissing = true;
          currentRecord.clearTimer = setTimeout(() => {
            setNoticeList((prev) => prev.filter((item) => item.id !== noticeId));
            noticeTimersRef.current.delete(noticeId);
          }, 300);
        }
      }, hideDelay);

      const existing = noticeTimersRef.current.get(noticeId);
      if (existing) {
        existing.dismissing = false;
        existing.hideTimer = hideTimer;
      } else {
        noticeTimersRef.current.set(noticeId, { type, dismissing: false, hideTimer });
      }
    },
    [clearNoticeTimers]
  );

  const dismissNotice = useCallback(
    (noticeId: number) => {
      const record = noticeTimersRef.current.get(noticeId);
      if (!record || record.dismissing) return;

      record.dismissing = true;
      clearNoticeTimers(noticeId, false);

      setNoticeList((prev) => {
        const target = prev.find((item) => item.id === noticeId);
        if (!target || target.dismissing) return prev;
        return prev.map((item) =>
          item.id === noticeId
            ? {
                ...item,
                visible: false,
                dismissing: true
              }
            : item
        );
      });

      const clearTimer = setTimeout(() => {
        setNoticeList((prev) => prev.filter((item) => item.id !== noticeId));
        noticeTimersRef.current.delete(noticeId);
      }, 300);

      record.clearTimer = clearTimer;
    },
    [clearNoticeTimers]
  );

  const pauseNotice = useCallback(
    (noticeId: number) => {
      const record = noticeTimersRef.current.get(noticeId);
      if (!record || record.dismissing) return;

      clearNoticeTimers(noticeId, false);
      setNoticeList((prev) => {
        const target = prev.find((item) => item.id === noticeId);
        if (!target || target.dismissing || target.visible) return prev;
        return prev.map((item) =>
          item.id === noticeId
            ? {
                ...item,
                visible: true,
                dismissing: false
              }
            : item
        );
      });
    },
    [clearNoticeTimers]
  );

  const resumeNotice = useCallback(
    (noticeId: number) => {
      const record = noticeTimersRef.current.get(noticeId);
      if (!record || record.dismissing) return;
      scheduleNoticeDismiss(noticeId, record.type);
    },
    [scheduleNoticeDismiss]
  );

  const enqueueNotice = useCallback(
    (type: NoticeState["type"], message: string, details?: string[]) => {
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
          visible: false,
          dismissing: false
        }
      ]);

      window.requestAnimationFrame(() => {
        setNoticeList((prev) =>
          prev.map((item) =>
            item.id === noticeId
              ? {
                  ...item,
                  visible: true,
                  dismissing: false
                }
              : item
          )
        );
      });

      scheduleNoticeDismiss(noticeId, type);
    },
    [scheduleNoticeDismiss]
  );

  const notifySuccess = useCallback(
    (message: string, details?: string[]) => {
      enqueueNotice("success", message, details);
    },
    [enqueueNotice]
  );

  const notifyError = useCallback(
    (message: string, details?: string[]) => {
      enqueueNotice("error", message, details);
    },
    [enqueueNotice]
  );

  return {
    noticeList,
    notifySuccess,
    notifyError,
    dismissNotice,
    pauseNotice,
    resumeNotice
  };
}
