import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-auth";
import {
  batchSaveRecordDrafts,
  getAdminRecordMatrix,
  MAX_RECORD_DRAFTS_PER_SAVE
} from "@/lib/admin-records-service";
import { resolveRecordsErrorStatus } from "./error-status";

const sourceModeSchema = z.enum(["all", "specific", "empty"]);

const draftSchema = z.object({
  modelId: z.number().int().positive(),
  benchmarkId: z.number().int().positive(),
  recordId: z.number().int().positive().nullable().optional(),
  recordIds: z.array(z.number().int().positive()).max(500).optional(),
  valueRaw: z.string().max(500),
  originalValueRaw: z.string().max(500).nullable().optional(),
  source: z.string().max(200).nullable().optional(),
  isDeleted: z.boolean().optional()
});

const saveSchema = z.object({
  drafts: z.array(draftSchema).min(1).max(MAX_RECORD_DRAFTS_PER_SAVE)
});

function parseIdList(raw: string | null): number[] | undefined {
  if (!raw) return undefined;

  const ids = raw
    .split(",")
    .map((item) => Number.parseInt(item.trim(), 10))
    .filter((id) => Number.isInteger(id) && id > 0);

  return ids.length > 0 ? ids : undefined;
}

function parsePositiveInt(raw: string | null): number | undefined {
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export async function GET(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const url = new URL(request.url);
  const sourceModeRaw = url.searchParams.get("sourceMode");
  const sourceMode = sourceModeSchema.safeParse(sourceModeRaw ?? "all");

  if (!sourceMode.success) {
    return NextResponse.json({ error: "sourceMode 只能是 all / specific / empty" }, { status: 400 });
  }

  try {
    const matrix = await getAdminRecordMatrix({
      sourceMode: sourceMode.data,
      source: url.searchParams.get("source"),
      modelIds: parseIdList(url.searchParams.get("modelIds")),
      benchmarkIds: parseIdList(url.searchParams.get("benchmarkIds")),
      search: url.searchParams.get("search"),
      modelLimit: parsePositiveInt(url.searchParams.get("modelLimit")),
      benchmarkLimit: parsePositiveInt(url.searchParams.get("benchmarkLimit"))
    });

    return NextResponse.json(matrix);
  } catch (error) {
    const message = error instanceof Error ? error.message : "加载数据矩阵失败";
    return NextResponse.json({ error: message }, { status: resolveRecordsErrorStatus(message) });
  }
}

export async function POST(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const parsed = saveSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const result = await batchSaveRecordDrafts({ drafts: parsed.data.drafts });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "批量保存失败";
    return NextResponse.json({ error: message }, { status: resolveRecordsErrorStatus(message) });
  }
}
