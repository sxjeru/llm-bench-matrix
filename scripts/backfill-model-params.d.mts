/**
 * scripts/backfill-model-params.mjs 的类型声明。
 *
 * 该脚本必须能在没有 TypeScript 编译的环境下直接 node 运行，因此本体是 .mjs；
 * 这里只为它暴露给单测的纯函数补类型。
 */

/** 按 model 聚合的 benchmark_values 查询结果（数值列经 pg 驱动可能是字符串） */
export type DeletionCandidateModelRow = {
  model_id: number;
  model_name: string;
  merged_into_model_id: number | null;
  total_params_b: string | number | null;
  value_count: string | number;
};

export type DeletionBlockingItem = {
  modelName: string;
  valueCount: number;
  reason: string;
};

/**
 * 返回删除该 benchmark 时会丢失的记录；空数组代表可安全删除。
 */
export function computeDeletionBlocking(
  modelRows: readonly DeletionCandidateModelRow[],
  plannedModelIds: ReadonlySet<number>
): DeletionBlockingItem[];
