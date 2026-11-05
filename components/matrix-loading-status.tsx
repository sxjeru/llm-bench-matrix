"use client";

export type MatrixLoadStage = "fetching" | "decoding" | "indexing" | "rendering";

type MatrixLoadStep = {
  key: MatrixLoadStage;
  label: string;
  /** 步骤进度，仅表示「走到第几步」的量级，不代表真实耗时比例 */
  percent: number;
};

export const MATRIX_LOAD_STAGES: readonly MatrixLoadStep[] = [
  { key: "fetching", label: "获取快照", percent: 12 },
  { key: "decoding", label: "解析数据", percent: 48 },
  { key: "indexing", label: "建立索引", percent: 72 },
  { key: "rendering", label: "渲染表格", percent: 92 }
];

function resolveMatrixLoadStep(stage: MatrixLoadStage | null | undefined): MatrixLoadStep {
  return MATRIX_LOAD_STAGES.find((item) => item.key === stage) ?? MATRIX_LOAD_STAGES[0]!;
}

/**
 * 首页矩阵的加载占位。快照请求、解码、派生索引、整表渲染各占一步，
 * 让那段「什么也看不到」的等待能说清楚卡在哪一步。
 */
export function MatrixLoadingStatus({
  stage,
  error
}: {
  stage?: MatrixLoadStage | null;
  error?: string | null;
}) {
  if (error) {
    return (
      <div className="card matrix-loading" role="status">
        <p className="matrix-loading-error">{error}</p>
      </div>
    );
  }

  const currentStep = resolveMatrixLoadStep(stage);
  const activeIndex = MATRIX_LOAD_STAGES.indexOf(currentStep);

  return (
    <div className="card matrix-loading" role="status" aria-live="polite">
      <div className="matrix-loading-head">
        <span className="matrix-loading-spinner" aria-hidden="true" />
        <span className="matrix-loading-title">正在加载矩阵数据…</span>
        <span className="matrix-loading-step">
          {currentStep.label} · {activeIndex + 1}/{MATRIX_LOAD_STAGES.length}
        </span>
      </div>
      <div className="matrix-loading-track" aria-hidden="true">
        <span className="matrix-loading-fill" style={{ width: `${currentStep.percent}%` }} />
      </div>
      <ol className="matrix-loading-steps">
        {MATRIX_LOAD_STAGES.map((item, index) => (
          <li
            key={item.key}
            className={`matrix-loading-step-item is-${
              index < activeIndex ? "done" : index === activeIndex ? "active" : "pending"
            }`}
          >
            <span className="matrix-loading-bullet" aria-hidden="true" />
            {item.label}
          </li>
        ))}
      </ol>
    </div>
  );
}
