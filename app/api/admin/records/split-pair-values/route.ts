import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-auth";
import { getRecordDualValueCandidates, splitDualValueRecords } from "@/lib/admin-records-service";
import { resolveRecordsErrorStatus } from "../error-status";

const scopeSchema = z
  .object({
    modelIds: z.array(z.number().int().positive()).max(500).optional(),
    benchmarkIds: z.array(z.number().int().positive()).max(500).optional(),
    sourceMode: z.enum(["all", "specific", "empty"]).optional(),
    source: z.string().max(200).nullable().optional()
  })
  .optional();

const targetSchema = z
  .object({
    benchmarkId: z.number().int().positive().optional(),
    benchmarkName: z.string().trim().max(200).optional(),
    benchmarkType: z.string().trim().max(100).optional()
  })
  .refine((value) => typeof value.benchmarkId === "number" || Boolean(value.benchmarkName?.trim()), {
    message: "拆分目标需要给出 benchmarkId 或 benchmarkName"
  });

const schema = z.object({
  benchmarkId: z.number().int().positive(),
  first: targetSchema,
  second: targetSchema,
  scope: scopeSchema
});

function parseIdList(raw: string | null): number[] | undefined {
  if (!raw) return undefined;

  const ids = raw
    .split(",")
    .map((item) => Number.parseInt(item.trim(), 10))
    .filter((id) => Number.isInteger(id) && id > 0);

  return ids.length > 0 ? ids : undefined;
}

/** 拆分向导的候选预览：当前筛选范围内还有哪些 benchmark 存在 `77 / 88` 这类双值 */
export async function GET(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const url = new URL(request.url);
  const sourceMode = z
    .enum(["all", "specific", "empty"])
    .safeParse(url.searchParams.get("sourceMode") ?? "all");

  if (!sourceMode.success) {
    return NextResponse.json({ error: "sourceMode 只能是 all / specific / empty" }, { status: 400 });
  }

  try {
    const result = await getRecordDualValueCandidates({
      sourceMode: sourceMode.data,
      source: url.searchParams.get("source"),
      modelIds: parseIdList(url.searchParams.get("modelIds")),
      benchmarkIds: parseIdList(url.searchParams.get("benchmarkIds"))
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "加载双值候选失败";
    return NextResponse.json({ error: message }, { status: resolveRecordsErrorStatus(message) });
  }
}

export async function POST(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const result = await splitDualValueRecords(parsed.data);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "双值分拆失败";
    return NextResponse.json({ error: message }, { status: resolveRecordsErrorStatus(message) });
  }
}
