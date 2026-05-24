import { useCallback, type Dispatch, type SetStateAction } from "react";
import { EXPORT_PRESET_MAP } from "./constants";
import {
  mimeTypeToFormat,
  renderElementToImageBlob,
  withTimeout
} from "./export-image";
import type { ExportPresetKey } from "./types";

type MutableRefValue<T> = {
  current: T;
};

type CopyNotice = {
  type: "success" | "error";
  message: string;
};

type UseMatrixImageActionsOptions = {
  tableViewportRef: MutableRefValue<HTMLDivElement | null>;
  exportPreset: ExportPresetKey;
  isImageActionBusy: boolean;
  setIsExportMenuOpen: Dispatch<SetStateAction<boolean>>;
  setSuppressHoverMenu: Dispatch<SetStateAction<boolean>>;
  setIsCopyingTableImage: Dispatch<SetStateAction<boolean>>;
  setIsDownloadingTableImage: Dispatch<SetStateAction<boolean>>;
  setIsExportCaptureMode: Dispatch<SetStateAction<boolean>>;
  setCopyNotice: Dispatch<SetStateAction<CopyNotice | null>>;
  setCopyNoticeVisible: Dispatch<SetStateAction<boolean>>;
};

export function useMatrixImageActions({
  tableViewportRef,
  exportPreset,
  isImageActionBusy,
  setIsExportMenuOpen,
  setSuppressHoverMenu,
  setIsCopyingTableImage,
  setIsDownloadingTableImage,
  setIsExportCaptureMode,
  setCopyNotice,
  setCopyNoticeVisible
}: UseMatrixImageActionsOptions) {
  const copyTableImageToClipboard = useCallback(async () => {
    if (!tableViewportRef.current || isImageActionBusy) return;

    setIsExportMenuOpen(false);
    setSuppressHoverMenu(true);
    setIsCopyingTableImage(true);
    setIsExportCaptureMode(true);
    setCopyNotice(null);
    setCopyNoticeVisible(false);

    try {
      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => resolve());
      });

      const { scale } = EXPORT_PRESET_MAP[exportPreset];
      const pngBlob = await withTimeout(
        renderElementToImageBlob(tableViewportRef.current, scale, "image/png"),
        12000,
        "导出超时，请稍后重试"
      );

      if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
        throw new Error("当前浏览器不支持图片剪贴板");
      }

      await withTimeout(
        navigator.clipboard.write([
          new ClipboardItem({
            "image/png": pngBlob
          })
        ]),
        5000,
        "复制超时，请检查剪贴板权限"
      );

      setCopyNotice({ type: "success", message: "已复制表格 PNG 到剪贴板" });
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : "";
      const message = rawMessage.includes("Tainted canvases")
        ? "复制失败：检测到跨域资源，请重试或切换到无扩展干扰窗口"
        : rawMessage || "复制失败，请检查浏览器剪贴板权限";
      setCopyNotice({ type: "error", message });
    } finally {
      setIsExportCaptureMode(false);
      setIsCopyingTableImage(false);
    }
  }, [
    exportPreset,
    isImageActionBusy,
    setCopyNotice,
    setCopyNoticeVisible,
    setIsCopyingTableImage,
    setIsExportCaptureMode,
    setIsExportMenuOpen,
    setSuppressHoverMenu,
    tableViewportRef
  ]);

  const downloadTableImage = useCallback(async () => {
    if (!tableViewportRef.current || isImageActionBusy) return;

    setIsExportMenuOpen(false);
    setSuppressHoverMenu(true);
    setIsDownloadingTableImage(true);
    setIsExportCaptureMode(true);
    setCopyNotice(null);
    setCopyNoticeVisible(false);

    try {
      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => resolve());
      });

      const preset = EXPORT_PRESET_MAP[exportPreset];
      const imageBlob = await withTimeout(
        renderElementToImageBlob(tableViewportRef.current, preset.scale, preset.mimeType),
        12000,
        "导出超时，请稍后重试"
      );

      const outputFormat = mimeTypeToFormat(imageBlob.type);
      const requestedFormat = preset.format;

      const fileTime = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
      const fileName = `benchmark-matrix-${fileTime}.${outputFormat}`;
      const objectUrl = URL.createObjectURL(imageBlob);

      try {
        const link = document.createElement("a");
        link.href = objectUrl;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } finally {
        URL.revokeObjectURL(objectUrl);
      }

      setCopyNotice({
        type: "success",
        message: outputFormat === requestedFormat
          ? `已导出表格 ${outputFormat.toUpperCase()}`
          : `已自动回退导出 ${outputFormat.toUpperCase()}（原选择 ${requestedFormat.toUpperCase()}）`
      });
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : "";
      const message = rawMessage.includes("Tainted canvases")
        ? "下载失败：检测到跨域资源，请重试或切换到无扩展干扰窗口"
        : rawMessage || "下载失败，请稍后重试";
      setCopyNotice({ type: "error", message });
    } finally {
      setIsExportCaptureMode(false);
      setIsDownloadingTableImage(false);
    }
  }, [
    exportPreset,
    isImageActionBusy,
    setCopyNotice,
    setCopyNoticeVisible,
    setIsDownloadingTableImage,
    setIsExportCaptureMode,
    setIsExportMenuOpen,
    setSuppressHoverMenu,
    tableViewportRef
  ]);

  return {
    copyTableImageToClipboard,
    downloadTableImage
  };
}
