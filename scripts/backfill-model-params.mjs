#!/usr/bin/env node
/**
 * 把旧的「Params (B) (activated / total)」benchmark 数据迁移到 models 表的参数量列。
 *
 * 旧结构把参数量当成 benchmark 值存，因此绑死在单一 source 上；本脚本按
 * value_num -> activated、value_num2 -> total 的既有约定搬到模型属性上。
 *
 * 用法：
 *   node scripts/backfill-model-params.mjs            # dry-run，只打印将要写入/删除的内容
 *   node scripts/backfill-model-params.mjs --apply    # 实际写库
 *   node scripts/backfill-model-params.mjs --apply --force   # 连同已填写的模型一并覆盖
 *   node scripts/backfill-model-params.mjs --apply --delete-benchmark   # 迁移后删除原 benchmark
 *
 * --delete-benchmark 会连带删除该 benchmark 的全部 benchmark_values 与 source 元数据
 * （外键 ON DELETE CASCADE），不可恢复。只有当该 benchmark 下所有记录都已成功迁移时
 * 才会执行，存在未迁移记录时会拒绝删除并列出原因，除非同时加 --force。
 *
 * 连接与 SSL 逻辑刻意与 scripts/migrate.mjs 保持一致：该脚本同样要在
 * 没有 TypeScript 编译与 Next.js 运行时的环境下直接跑。
 */
import "dotenv/config";
import { pathToFileURL } from "node:url";

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || "";

const useNeon =
  process.env.DATABASE_DRIVER === "neon" ||
  (process.env.DATABASE_DRIVER !== "pg" && /\.neon\.tech/.test(connectionString));

const args = new Set(process.argv.slice(2));
const shouldApply = args.has("--apply");
const shouldForce = args.has("--force");
const shouldDeleteBenchmark = args.has("--delete-benchmark");

const PG_SSL_QUERY_KEYS = [
  "ssl", "sslmode", "sslcert", "sslkey",
  "sslrootcert", "sslpassword", "sslaccept", "uselibpqcompat"
];

function normalizeEnvMultiline(value) {
  let normalized = value.trim();
  if (
    (normalized.startsWith('"') && normalized.endsWith('"')) ||
    (normalized.startsWith("'") && normalized.endsWith("'"))
  ) {
    normalized = normalized.slice(1, -1);
  }
  return normalized.replace(/\\n/g, "\n");
}

function stripPgSslParams(urlString) {
  try {
    const url = new URL(urlString);
    for (const key of PG_SSL_QUERY_KEYS) {
      url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return urlString;
  }
}

function getSSLOptions() {
  const ca = process.env.DATABASE_CA;
  if (!ca) return undefined;

  const normalized = normalizeEnvMultiline(ca);
  if (normalized.includes("-----BEGIN CERTIFICATE-----")) {
    return { ca: normalized, rejectUnauthorized: true };
  }

  const decoded = Buffer.from(normalized, "base64").toString("utf8").trim();
  return { ca: normalizeEnvMultiline(decoded), rejectUnauthorized: true };
}

async function createClient() {
  if (useNeon) {
    const { Pool, neonConfig } = await import("@neondatabase/serverless");
    const { WebSocket } = await import("ws");
    neonConfig.webSocketConstructor = WebSocket;
    const pool = new Pool({ connectionString });
    return { query: (text, params) => pool.query(text, params), end: () => pool.end() };
  }

  const pg = await import("pg");
  const sslOptions = getSSLOptions();
  const pool = new pg.default.Pool({
    connectionString: sslOptions ? stripPgSslParams(connectionString) : connectionString,
    ssl: sslOptions,
    max: 2
  });
  return { query: (text, params) => pool.query(text, params), end: () => pool.end() };
}

function toNumber(value) {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function formatB(value) {
  return value === null ? "--" : `${Number(value.toFixed(3)).toString()}B`;
}

/**
 * 判断一个 benchmark 是否还有「删了就会丢」的记录。
 *
 * 纯函数，便于单测覆盖：删除是不可逆的，这段判定是唯一的安全闸门。
 *
 * modelRows 来自按 model 聚合的查询，且刻意不过滤 merged_into_model_id ——
 * 主迁移只处理活跃模型，但删除会连带清掉挂在已合并模型上的记录。
 */
export function computeDeletionBlocking(modelRows, plannedModelIds) {
  return modelRows
    // 已有参数量的模型不算阻塞；本次待写入的模型在 apply 后也会有值
    .filter((row) => toNumber(row.total_params_b) === null && !plannedModelIds.has(row.model_id))
    .map((row) => ({
      modelName: row.model_name,
      valueCount: Number(row.value_count),
      reason: row.merged_into_model_id !== null ? "模型已被合并，未参与迁移" : "参数量未迁移成功"
    }));
}

/** 统计每个 benchmark 的删除影响面 */
async function buildBenchmarkDeletionPlans(client, benchmarkIds, plannedModelIds) {
  const plans = [];

  for (const benchmarkId of benchmarkIds) {
    const { rows: metaRows } = await client.query(
      "SELECT benchmark_name, benchmark_type FROM benchmarks WHERE id = $1",
      [benchmarkId]
    );
    if (metaRows.length === 0) continue;

    const { rows: modelRows } = await client.query(
      `SELECT m.id                  AS model_id,
              m.model_name          AS model_name,
              m.merged_into_model_id AS merged_into_model_id,
              m.total_params_b      AS total_params_b,
              count(v.id)           AS value_count
         FROM benchmark_values v
         JOIN models m ON m.id = v.model_id
        WHERE v.benchmark_id = $1
        GROUP BY m.id, m.model_name, m.merged_into_model_id, m.total_params_b`,
      [benchmarkId]
    );

    plans.push({
      benchmarkId,
      benchmarkName: metaRows[0].benchmark_name,
      benchmarkType: metaRows[0].benchmark_type,
      totalValueCount: modelRows.reduce((sum, row) => sum + Number(row.value_count), 0),
      blocking: computeDeletionBlocking(modelRows, plannedModelIds)
    });
  }

  return plans;
}

function printBenchmarkDeletionPlans(plans) {
  console.log("待删除的原 benchmark：");
  for (const plan of plans) {
    const label = `${plan.benchmarkName}（${plan.benchmarkType}）[${plan.benchmarkId}]`;
    if (plan.blocking.length > 0 && !shouldForce) {
      console.log(`  ✗ ${label} — 存在未迁移记录，将跳过：`);
      for (const item of plan.blocking) {
        console.log(`      ${item.modelName}（${item.valueCount} 条）：${item.reason}`);
      }
      continue;
    }

    const forcedNote = plan.blocking.length > 0 ? "，其中含未迁移记录（--force 已放行）" : "";
    console.log(`  ✓ ${label} — 连带删除 ${plan.totalValueCount} 条 benchmark_values${forcedNote}`);
  }
  console.log("");
}

async function run() {
  if (!connectionString) {
    console.error("[backfill-params] 缺少数据库连接串，请设置 DATABASE_URL 或 POSTGRES_URL。");
    process.exitCode = 1;
    return;
  }

  const client = await createClient();

  try {
    const { rows: columnRows } = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'models' AND column_name IN ('total_params_b', 'activated_params_b')
    `);

    if (columnRows.length < 2) {
      console.error("[backfill-params] models 表还没有参数量列，请先执行 pnpm db:migrate。");
      process.exitCode = 1;
      return;
    }

    const { rows: sourceRows } = await client.query(`
      SELECT
        m.id            AS model_id,
        m.model_name    AS model_name,
        m.total_params_b     AS existing_total,
        m.activated_params_b AS existing_activated,
        v.value_raw     AS value_raw,
        v.value_num     AS value_num,
        v.value_num2    AS value_num2,
        v.bench_time    AS bench_time,
        b.id            AS benchmark_id,
        b.benchmark_name AS benchmark_name,
        b.benchmark_type AS benchmark_type
      FROM benchmark_values v
      JOIN benchmarks b ON b.id = v.benchmark_id
      JOIN models m ON m.id = v.model_id
      WHERE b.benchmark_type ILIKE 'Model Info'
        AND b.benchmark_name ILIKE '%param%'
        AND m.merged_into_model_id IS NULL
      ORDER BY m.model_name, v.bench_time DESC, v.id DESC
    `);

    if (sourceRows.length === 0) {
      console.log("[backfill-params] 未找到 Model Info 类型的 Params benchmark 数据，无需迁移。");
      return;
    }

    // 同一模型可能有多条记录，取 bench_time 最新的一条
    const latestByModel = new Map();
    for (const row of sourceRows) {
      if (!latestByModel.has(row.model_id)) {
        latestByModel.set(row.model_id, row);
      }
    }

    const planned = [];
    const skipped = [];

    for (const row of latestByModel.values()) {
      // 旧约定：成对值 "17 / 397" 存成 value_num=17（激活）、value_num2=397（总量）；
      // 单值 "397" 只有 value_num，视为稠密模型的总参数量。
      const first = toNumber(row.value_num);
      const second = toNumber(row.value_num2);
      const isPair = second !== null;
      const total = isPair ? second : first;
      const activated = isPair ? first : null;

      if (total === null) {
        skipped.push({ ...row, reason: "无法解析出总参数量" });
        continue;
      }

      if (activated !== null && activated > total) {
        skipped.push({ ...row, reason: `激活值 ${activated} 大于总量 ${total}` });
        continue;
      }

      const hasExisting =
        toNumber(row.existing_total) !== null || toNumber(row.existing_activated) !== null;
      if (hasExisting && !shouldForce) {
        skipped.push({ ...row, reason: "已有参数量，跳过（--force 可覆盖）" });
        continue;
      }

      planned.push({
        modelId: row.model_id,
        modelName: row.model_name,
        valueRaw: row.value_raw,
        total,
        activated
      });
    }

    console.log(`[backfill-params] 命中 benchmark 记录 ${sourceRows.length} 条，涉及模型 ${latestByModel.size} 个。`);
    console.log(`[backfill-params] 待写入 ${planned.length} 个，跳过 ${skipped.length} 个。\n`);

    if (planned.length > 0) {
      console.log("待写入：");
      for (const item of planned) {
        const display = item.activated === null
          ? formatB(item.total)
          : `${formatB(item.activated)} / ${formatB(item.total)}`;
        console.log(`  ${item.modelName.padEnd(36)} ${String(item.valueRaw).padEnd(14)} ->  ${display}`);
      }
      console.log("");
    }

    if (skipped.length > 0) {
      console.log("跳过：");
      for (const item of skipped) {
        console.log(`  ${item.model_name.padEnd(36)} ${item.reason}`);
      }
      console.log("");
    }

    const benchmarkIds = Array.from(new Set(sourceRows.map((row) => row.benchmark_id)));
    const plannedModelIds = new Set(planned.map((item) => item.modelId));
    const deletionPlans = shouldDeleteBenchmark
      ? await buildBenchmarkDeletionPlans(client, benchmarkIds, plannedModelIds)
      : [];

    if (shouldDeleteBenchmark) {
      printBenchmarkDeletionPlans(deletionPlans);
    }

    if (!shouldApply) {
      console.log("[backfill-params] dry-run 结束，未写入或删除任何数据。确认无误后加 --apply 执行。");
      return;
    }

    if (planned.length === 0) {
      console.log("[backfill-params] 没有需要写入的参数量。");
    } else {
      for (const item of planned) {
        await client.query(
          `UPDATE models
             SET total_params_b = $1,
                 activated_params_b = $2,
                 params_note = COALESCE(params_note, $3)
           WHERE id = $4`,
          [item.total, item.activated, `迁移自 benchmark「${item.valueRaw}」`, item.modelId]
        );
      }

      console.log(`[backfill-params] 已写入 ${planned.length} 个模型的参数量。`);
    }

    if (!shouldDeleteBenchmark) {
      console.log("[backfill-params] 提示：旧的 Params benchmark 仍在库中，可加 --delete-benchmark 或在后台「数据库设置 → 删除单个 benchmark」清理。");
      return;
    }

    let deletedBenchmarkCount = 0;
    let deletedValueCount = 0;

    for (const plan of deletionPlans) {
      if (plan.blocking.length > 0 && !shouldForce) {
        console.log(`[backfill-params] 跳过删除 ${plan.benchmarkName}：存在 ${plan.blocking.length} 个模型的记录未迁移。`);
        continue;
      }

      // merged_into_benchmark_id 是 ON DELETE SET NULL，benchmark_values 与
      // benchmark_source_meta 是 ON DELETE CASCADE，单条 DELETE 即可原子完成，
      // 不必在连接池上手动开事务
      const { rows } = await client.query(
        "DELETE FROM benchmarks WHERE id = $1 RETURNING id, benchmark_name",
        [plan.benchmarkId]
      );

      if (rows.length > 0) {
        deletedBenchmarkCount += 1;
        deletedValueCount += plan.totalValueCount;
        console.log(`[backfill-params] 已删除 benchmark：${rows[0].benchmark_name}（连带 ${plan.totalValueCount} 条记录）`);
      }
    }

    console.log(`[backfill-params] 共删除 ${deletedBenchmarkCount} 个 benchmark、${deletedValueCount} 条 benchmark_values。`);
  } finally {
    await client.end();
  }
}

// 被测试 import 时不自动执行，只在直接 node 运行时跑
const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  run().catch((error) => {
    console.error("[backfill-params] 执行失败：", error);
    process.exit(1);
  });
}
