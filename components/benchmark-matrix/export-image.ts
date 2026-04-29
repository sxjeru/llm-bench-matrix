import { AVIF_EXPORT_QUALITY, COMPARE_BASELINE_FRAME_COLOR, COMPARE_BASELINE_FRAME_EXPORT_COLOR, EXPORT_PRESET_MAP, SOURCE_MATCH_FRAME_COLOR, WEBP_EXPORT_QUALITY } from "./constants";
import type { CompareBaselineShadowBuildInput, ExportFormat, ExportMimeType, ExportPresetKey, Html2CanvasFn, SourceFrameShadowBuildInput } from "./types";

export function isExportPresetKey(value: string): value is ExportPresetKey {
  return value in EXPORT_PRESET_MAP;
}

export function canEncodeCanvasMimeType(mimeType: ExportMimeType): boolean {
  if (typeof document === "undefined") return false;

  const probeCanvas = document.createElement("canvas");
  probeCanvas.width = 2;
  probeCanvas.height = 2;
  const context = probeCanvas.getContext("2d");
  if (!context) return false;

  context.fillStyle = "#111827";
  context.fillRect(0, 0, 2, 2);

  try {
    return probeCanvas.toDataURL(mimeType, 0.9).startsWith(`data:${mimeType}`);
  } catch {
    return false;
  }
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [header, base64 = ""] = dataUrl.split(",");
  const mimeMatch = header.match(/^data:(.*?);base64$/);
  const mimeType = mimeMatch?.[1] ?? "application/octet-stream";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return new Blob([bytes], { type: mimeType });
}

export function getMimeTypeFallbackChain(mimeType: ExportMimeType): ExportMimeType[] {
  if (mimeType === "image/avif") {
    return ["image/avif", "image/webp", "image/png"];
  }
  if (mimeType === "image/webp") {
    return ["image/webp", "image/png"];
  }
  return ["image/png"];
}

export function getEncoderQuality(mimeType: ExportMimeType): number | undefined {
  if (mimeType === "image/webp") return WEBP_EXPORT_QUALITY;
  if (mimeType === "image/avif") return AVIF_EXPORT_QUALITY;
  return undefined;
}

export function mimeTypeToFormat(mimeType: string): ExportFormat {
  const normalized = mimeType.toLowerCase();
  if (normalized.includes("avif")) return "avif";
  if (normalized.includes("webp")) return "webp";
  return "png";
}

export function buildSourceFrameShadows(input: SourceFrameShadowBuildInput): string[] {
  if (!input.isMatched) {
    return [];
  }

  const edgeSize = 2;
  const frameColor = input.exportMode ? "rgba(93, 167, 255, 0.72)" : SOURCE_MATCH_FRAME_COLOR;

  const shadows: string[] = [];

  if (input.includeTop) {
    shadows.push(`inset 0 ${edgeSize}px 0 ${frameColor}`);
  }
  if (input.includeBottom) {
    shadows.push(`inset 0 -${edgeSize}px 0 ${frameColor}`);
  }
  if (input.isFirst) {
    shadows.push(`inset ${edgeSize}px 0 0 ${frameColor}`);
  }
  if (input.isLast) {
    shadows.push(`inset -${edgeSize}px 0 0 ${frameColor}`);
  }

  return shadows;
}

export function __buildSourceFrameShadowsForTest(input: SourceFrameShadowBuildInput): string[] {
  return buildSourceFrameShadows(input);
}

export function buildCompareBaselineShadows(input: CompareBaselineShadowBuildInput): string[] {
  if (!input.isBaseline) {
    return [];
  }

  const edgeSize = 2;
  const frameColor = input.exportMode ? COMPARE_BASELINE_FRAME_EXPORT_COLOR : COMPARE_BASELINE_FRAME_COLOR;
  const shadows = [
    `inset ${edgeSize}px 0 0 ${frameColor}`,
    `inset -${edgeSize}px 0 0 ${frameColor}`
  ];

  if (input.includeTop) {
    shadows.push(`inset 0 ${edgeSize}px 0 ${frameColor}`);
  }
  if (input.includeBottom) {
    shadows.push(`inset 0 -${edgeSize}px 0 ${frameColor}`);
  }

  return shadows;
}

export function __buildCompareBaselineShadowsForTest(input: CompareBaselineShadowBuildInput): string[] {
  return buildCompareBaselineShadows(input);
}

export function applyExportSourceFrameFallback(root: HTMLElement, color: string, width: number): void {
  const sourceMatchedCells = root.querySelectorAll<HTMLElement>("[data-source-match='1']");

  sourceMatchedCells.forEach((cell) => {
    cell.style.boxShadow = "none";

    if (cell.dataset.sourceMatchFirst === "1") {
      cell.style.borderLeft = `${width}px solid ${color}`;
    }
    if (cell.dataset.sourceMatchLast === "1") {
      cell.style.borderRight = `${width}px solid ${color}`;
    }
    if (cell.tagName === "TH") {
      cell.style.borderTop = `${width}px solid ${color}`;
    }
    if (cell.dataset.sourceMatchBottom === "1") {
      cell.style.borderBottom = `${width}px solid ${color}`;
    }
  });
}

export function __applyExportSourceFrameFallbackForTest(root: HTMLElement, color = "rgba(93, 167, 255, 0.65)", width = 2): void {
  applyExportSourceFrameFallback(root, color, width);
}

export function applyExportCompareBaselineFallback(root: HTMLElement, color: string, width: number): void {
  const baselineCells = root.querySelectorAll<HTMLElement>("[data-compare-baseline='1']");

  baselineCells.forEach((cell) => {
    cell.style.borderLeft = `${width}px solid ${color}`;
    cell.style.borderRight = `${width}px solid ${color}`;

    if (cell.tagName === "TH") {
      cell.style.borderTop = `${width}px solid ${color}`;
    }

    if (cell.dataset.compareBaselineBottom === "1") {
      cell.style.borderBottom = `${width}px solid ${color}`;
    }
  });
}

export function __applyExportCompareBaselineFallbackForTest(root: HTMLElement, color = "rgba(250, 211, 106, 0.9)", width = 2): void {
  applyExportCompareBaselineFallback(root, color, width);
}

export function applyExportOverallRowNudgeFallback(root: HTMLElement): void {
  const overallRow = root.querySelector<HTMLTableRowElement>("tr[data-overall-row='1']");
  if (!overallRow) return;

  const overallBenchmarkLabel = overallRow.querySelector<HTMLElement>("[data-overall-benchmark-label='1']");
  if (overallBenchmarkLabel) {
    overallBenchmarkLabel.style.paddingTop = "8px";
    overallBenchmarkLabel.style.paddingBottom = "4px";
  }

  const overallBenchmarkCnText = overallRow.querySelector<HTMLElement>("[data-overall-benchmark-cn-text='1']");
  if (overallBenchmarkCnText) {
    overallBenchmarkCnText.style.display = "inline-block";
    overallBenchmarkCnText.style.transform = "translateY(2px)";
  }

  overallRow.querySelectorAll<HTMLElement>("[data-overall-tooltip-trigger]").forEach((trigger) => {
    trigger.style.top = "56%";
  });
}

export function resolveCaptureDimensions(element: HTMLElement): { width: number; height: number } {
  const table = element.querySelector("table") as HTMLElement | null;

  const widthSource = table
    ? Math.max(table.scrollWidth || 0, table.clientWidth || 0)
    : Math.max(element.scrollWidth || 0, element.clientWidth || 0);

  const heightSource = table
    ? Math.max(table.scrollHeight || 0, table.clientHeight || 0)
    : Math.max(element.scrollHeight || 0, element.clientHeight || 0);

  return {
    width: Math.max(1, Math.round(widthSource)),
    height: Math.max(1, Math.round(heightSource))
  };
}

export function __resolveCaptureDimensionsForTest(element: HTMLElement): { width: number; height: number } {
  return resolveCaptureDimensions(element);
}

let html2canvasLoaderPromise: Promise<Html2CanvasFn> | null = null;

export async function loadHtml2Canvas(): Promise<Html2CanvasFn> {
  if (typeof window === "undefined") {
    throw new Error("当前环境不支持图片导出");
  }

  if (html2canvasLoaderPromise) {
    return html2canvasLoaderPromise;
  }

  html2canvasLoaderPromise = import("html2canvas-pro")
    .then((module) => {
      const html2canvas = module.default as Html2CanvasFn | undefined;
      if (typeof html2canvas !== "function") {
        throw new Error("截图引擎加载失败");
      }
      return html2canvas;
    })
    .catch((error) => {
      html2canvasLoaderPromise = null;
      throw error instanceof Error ? error : new Error("无法加载截图引擎");
    });

  return html2canvasLoaderPromise;
}

export async function renderElementToImageBlob(
  element: HTMLElement,
  scale: number,
  mimeType: ExportMimeType
): Promise<Blob> {
  const html2canvas = await loadHtml2Canvas();

  const { width, height } = resolveCaptureDimensions(element);
  const captureBottomPadding = 4;
  const captureHeight = height + captureBottomPadding;
  const captureAttr = "data-h2c-export-root";

  element.setAttribute(captureAttr, "1");

  const canvas = await (async () => {
    try {
      return await html2canvas(element, {
        backgroundColor: "#0b1020",
        scale,
        foreignObjectRendering: false,
        useCORS: true,
        allowTaint: false,
        logging: false,
        scrollX: 0,
        scrollY: 0,
        width,
        height: captureHeight,
        windowWidth: width,
        windowHeight: captureHeight,
        onclone: (clonedDoc: Document) => {
          const clonedRoot = clonedDoc.querySelector(`[${captureAttr}="1"]`) as HTMLElement | null;
          if (!clonedRoot) return;

          clonedRoot.style.overflow = "visible";
          clonedRoot.style.maxHeight = "none";
          clonedRoot.style.height = `${captureHeight}px`;
          clonedRoot.style.width = `${width}px`;

          const clonedTable = clonedRoot.querySelector("table") as HTMLTableElement | null;
          if (clonedTable) {
            clonedTable.style.minWidth = `${width}px`;
            clonedTable.style.borderCollapse = "separate";
            clonedTable.style.borderSpacing = "0";
          }

          const clonedModalityFilters = clonedRoot.querySelectorAll<HTMLElement>("[data-modality-filter='true']");
          clonedModalityFilters.forEach((filter) => {
            filter.removeAttribute("open");
            filter.querySelectorAll<HTMLElement>(".dropdown-content").forEach((panel) => {
              panel.style.display = "none";
            });
          });

          const exportSourceFrameColor = "rgba(93, 167, 255, 0.65)";
          const exportSourceFrameWidth = 2;
          const exportCompareBaselineColor = "rgba(250, 211, 106, 0.9)";
          const exportCompareBaselineWidth = 2;
          applyExportOverallRowNudgeFallback(clonedRoot);
          applyExportSourceFrameFallback(clonedRoot, exportSourceFrameColor, exportSourceFrameWidth);
          applyExportCompareBaselineFallback(clonedRoot, exportCompareBaselineColor, exportCompareBaselineWidth);
        }
      });
    } finally {
      element.removeAttribute(captureAttr);
    }
  })();

  const mimeCandidates = getMimeTypeFallbackChain(mimeType);

  let blob: Blob | null = null;
  for (const candidateMimeType of mimeCandidates) {
    const quality = getEncoderQuality(candidateMimeType);

    const blobFromCanvas = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(
        (result) => resolve(result),
        candidateMimeType,
        quality
      );
    });

    if (blobFromCanvas) {
      const actualType = blobFromCanvas.type.toLowerCase();
      if (actualType.includes(candidateMimeType.replace("image/", "")) || candidateMimeType === "image/png") {
        blob = blobFromCanvas;
        break;
      }
    }

    try {
      const dataUrl = canvas.toDataURL(candidateMimeType, quality);
      if (dataUrl.startsWith(`data:${candidateMimeType}`)) {
        blob = dataUrlToBlob(dataUrl);
        break;
      }
    } catch {
      // try next fallback type
    }
  }

  if (!blob) {
    throw new Error("图片导出失败");
  }

  return blob;
}

export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  let timer: number | null = null;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer !== null) {
      window.clearTimeout(timer);
    }
  }) as Promise<T>;
}
