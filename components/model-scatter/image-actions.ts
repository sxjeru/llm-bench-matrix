"use client";

import { useCallback, useState, type RefObject } from "react";
import { EXPORT_PRESET_MAP } from "@/components/benchmark-matrix/constants";
import {
  mimeTypeToFormat,
  renderElementToImageBlob,
  withTimeout
} from "@/components/benchmark-matrix/export-image";
import type { ExportPresetKey } from "@/components/benchmark-matrix/types";

export type ScatterExportNotice = {
  type: "success" | "error";
  message: string;
};

/**
 * 散点图导出。
 *
 * 复用矩阵那套底层渲染原语（html2canvas-pro + 超时兜底 + 格式回退），
 * 但不复用 `useMatrixImageActions` —— 那个 hook 绑着矩阵专有的菜单与
 * 捕获模式状态，搬过来只会带进一堆用不上的开关。
 */
export function useScatterImageActions(
  captureRef: RefObject<HTMLElement | null>,
  exportPreset: ExportPresetKey
) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [isCopying, setIsCopying] = useState(false);
  const [notice, setNotice] = useState<ScatterExportNotice | null>(null);

  const isBusy = isDownloading || isCopying;

  const downloadImage = useCallback(async () => {
    if (!captureRef.current || isBusy) return;

    setIsDownloading(true);
    setNotice(null);

    try {
      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => resolve());
      });

      const preset = EXPORT_PRESET_MAP[exportPreset];
      const imageBlob = await withTimeout(
        renderElementToImageBlob(captureRef.current, preset.scale, preset.mimeType),
        12000,
        "导出超时，请稍后重试"
      );

      const outputFormat = mimeTypeToFormat(imageBlob.type);
      const fileTime = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
      const objectUrl = URL.createObjectURL(imageBlob);

      try {
        const link = document.createElement("a");
        link.href = objectUrl;
        link.download = `model-scatter-${fileTime}.${outputFormat}`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } finally {
        URL.revokeObjectURL(objectUrl);
      }

      setNotice({
        type: "success",
        message: outputFormat === preset.format
          ? `已导出散点图 ${outputFormat.toUpperCase()}`
          : `已自动回退导出 ${outputFormat.toUpperCase()}（原选择 ${preset.format.toUpperCase()}）`
      });
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : "";
      setNotice({ type: "error", message: rawMessage || "下载失败，请稍后重试" });
    } finally {
      setIsDownloading(false);
    }
  }, [captureRef, exportPreset, isBusy]);

  const copyImage = useCallback(async () => {
    if (!captureRef.current || isBusy) return;

    setIsCopying(true);
    setNotice(null);

    try {
      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => resolve());
      });

      const { scale } = EXPORT_PRESET_MAP[exportPreset];
      const pngBlob = await withTimeout(
        renderElementToImageBlob(captureRef.current, scale, "image/png"),
        12000,
        "导出超时，请稍后重试"
      );

      if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
        throw new Error("当前浏览器不支持图片剪贴板");
      }

      await withTimeout(
        navigator.clipboard.write([new ClipboardItem({ "image/png": pngBlob })]),
        5000,
        "复制超时，请检查剪贴板权限"
      );

      setNotice({ type: "success", message: "已复制散点图 PNG 到剪贴板" });
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : "";
      setNotice({ type: "error", message: rawMessage || "复制失败，请检查浏览器剪贴板权限" });
    } finally {
      setIsCopying(false);
    }
  }, [captureRef, exportPreset, isBusy]);

  return { downloadImage, copyImage, isDownloading, isCopying, isBusy, notice, setNotice };
}
