/**
 * AA 指数版本号的解析、比较与断代种子。
 *
 * 单独成文件的原因：服务端导入（`lib/admin-service.ts`、artificial-analysis-service）
 * 也要按版本判断「这次导入是重复同步还是一次重新评测」，而
 * `lib/aa-index-revisions.ts` 依赖前端组件模块，不能被服务端直接引用。
 */

export type AaVersionCutoff = {
  version: string | number;
  timestampMs: number;
  benchmarkName?: string;
  note?: string;
};

/**
 * AA 指标主要版本断代种子，**只用于冷启动**。
 *
 * settings 里一旦存在版本历史，本列表立即失效（见 mergeVersionCutoffs）。
 * 因此这里是「已知且无处可查的历史版本起点」，不是运行期事实来源：
 * 新增版本请写 settings，或在导入时自动记录（导入优先采用这里的生效日），
 * 不要再往这里追加，否则又会变成「改代码才能发版」。
 */
export const AA_INDEX_VERSION_SEEDS: AaVersionCutoff[] = [
  {
    version: "v5",
    timestampMs: new Date("2026-10-28T00:00:00.000Z").getTime(),
    benchmarkName: "AA Intelligence Index",
    note: "Artificial Analysis Intelligence Index v5"
  }
];

/** @deprecated 语义已改为「冷启动种子」，请用 AA_INDEX_VERSION_SEEDS */
export const DEFAULT_AA_INDEX_VERSION_CUTOFFS: AaVersionCutoff[] = AA_INDEX_VERSION_SEEDS;

/** 按版本号查种子，用于导入时把「首次观测时间」纠正成真实生效日 */
export function findAaVersionSeed(version: string | number | null | undefined): AaVersionCutoff | null {
  const normalized = normalizeAaVersion(version === null || version === undefined ? null : String(version));
  if (!normalized) return null;
  return (
    AA_INDEX_VERSION_SEEDS.find((seed) => normalizeAaVersion(String(seed.version)) === normalized) ?? null
  );
}

/**
 * 从 valueNote 中提取显式的版本标记（v5 / v4.1 / Intelligence Index v5）。
 *
 * 必须带 `v` 前缀：valueNote 同时承载人工备注，像 "2026-10-28 更新" 或
 * "GPT-5.5 数据" 这类文本里的数字并不是版本号，不能据此切断版本。
 */
export function extractAaVersionFromNote(note: string | null | undefined): string | null {
  if (!note) return null;
  const match = note.trim().match(/\bv(\d+(?:\.\d+)*)\b/i);
  return match ? `v${match[1]}` : null;
}

/** 把 "v4.1" / "4.1" 解析成 [4, 1]；不做模糊匹配，避免把日期、模型名当成版本 */
export function parseAaVersionParts(version: string | null | undefined): number[] | null {
  if (!version) return null;
  const match = version.trim().match(/^v?(\d+(?:\.\d+)*)$/i);
  if (!match) return null;
  const parts = match[1]!.split(".").map((part) => Number.parseInt(part, 10));
  return parts.every((part) => Number.isFinite(part)) ? parts : null;
}

/** 归一化成 "v5" 形式；无法识别返回 null */
export function normalizeAaVersion(version: string | null | undefined): string | null {
  const parts = parseAaVersionParts(version);
  return parts ? `v${parts.join(".")}` : null;
}

/** left 比 right 新返回正数，旧返回负数，相同返回 0；任一方无法识别时返回 null */
export function compareAaVersions(
  left: string | null | undefined,
  right: string | null | undefined
): number | null {
  const leftParts = parseAaVersionParts(left);
  const rightParts = parseAaVersionParts(right);
  if (!leftParts || !rightParts) return null;

  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const leftValue = leftParts[index] ?? 0;
    const rightValue = rightParts[index] ?? 0;
    if (leftValue !== rightValue) return leftValue - rightValue;
  }
  return 0;
}

/**
 * 合并自定义与内置切分点。
 *
 * - 完全没传：冷启动/预览环境，用代码里的种子兜底；
 * - 传空数组：明确关闭版本切分，一个切分点都不留；
 * - 传了非空配置：以配置为基准，但**补全比配置最高版本更新的种子**。
 *
 * 第三条是为了兜住「人工只回溯了 v4、还没导入过 v5」：此时 10-28 的数据
 * 会因为「最高已知版本是 v4」而被判回 v4，39 个模型的批次又并回 09-20。
 * 只补更高版本，不覆盖也不降级配置里的任何条目；要彻底关掉切分请传空数组。
 */
function mergeVersionCutoffs(customCutoffs?: readonly AaVersionCutoff[]): AaVersionCutoff[] {
  if (customCutoffs === undefined) {
    return AA_INDEX_VERSION_SEEDS.filter((cutoff) => Number.isFinite(cutoff.timestampMs));
  }

  const configured = customCutoffs.filter((cutoff) => Number.isFinite(cutoff.timestampMs));
  if (configured.length === 0) return [];

  let highestVersion: string | null = null;
  configured.forEach((cutoff) => {
    const version = normalizeAaVersion(String(cutoff.version));
    if (!version) return;
    if (!highestVersion || (compareAaVersions(version, highestVersion) ?? 0) > 0) {
      highestVersion = version;
    }
  });

  if (!highestVersion) return configured;

  const supplements = AA_INDEX_VERSION_SEEDS.filter((seed) => {
    if (!Number.isFinite(seed.timestampMs)) return false;
    const seedVersion = normalizeAaVersion(String(seed.version));
    if (!seedVersion) return false;
    return (compareAaVersions(seedVersion, highestVersion as string) ?? 0) > 0;
  });

  return supplements.length > 0 ? [...configured, ...supplements] : configured;
}

/**
 * 取 timestampMs 时刻生效的版本。
 *
 * 语义是半开区间 [cutoff(V), cutoff(next))：严格 `<=`，**不再向前放宽 4 小时**。
 * 之前用 `batch + 4h` 兜「批次时间早于切分点」，代价是把切换前 4 小时的 v4 补丁
 * 也标成了 v5。真正提前发布的新版本由批次内多数版本注释纠正。
 */
export function resolveCutoffVersionAt(
  timestampMs: number,
  benchmarkName?: string,
  customCutoffs?: readonly AaVersionCutoff[]
): string | null {
  // 没有 benchmark 名时无法判断这批切分点是否适用于当前指标。
  // 此前这里直接放行，导致所有指标都套用 AA Intelligence Index 的切分点。
  if (!benchmarkName || !Number.isFinite(timestampMs)) return null;

  const cutoffs = mergeVersionCutoffs(customCutoffs);
  const relevant = cutoffs.filter((c) => {
    if (!c.benchmarkName) return true;
    return c.benchmarkName.trim().toLowerCase() === benchmarkName.trim().toLowerCase();
  });

  let matchedCutoff: AaVersionCutoff | null = null;
  for (const c of relevant) {
    if (c.timestampMs <= timestampMs) {
      if (!matchedCutoff || c.timestampMs > matchedCutoff.timestampMs) {
        matchedCutoff = c;
      }
    }
  }

  if (!matchedCutoff) return null;

  const rawVersion = String(matchedCutoff.version);
  return normalizeAaVersion(rawVersion) ?? (rawVersion.startsWith("v") ? rawVersion : `v${rawVersion}`);
}
