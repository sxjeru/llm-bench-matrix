import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-auth";
import { updateAdminRecordDetails } from "@/lib/admin-records-service";
import { resolveRecordsErrorStatus } from "../error-status";

const recordSchema = z.object({
  id: z.number().int().positive(),
  modelId: z.number().int().positive(),
  benchmarkId: z.number().int().positive(),
  valueRaw: z.string().max(500),
  source: z.string().max(200).nullable(),
  benchTime: z.string().min(1).max(100),
  valueNote: z.string().max(2_000).nullable(),
  isDeleted: z.boolean().optional()
});

const schema = z.object({
  records: z.array(recordSchema).min(1).max(500)
});

export async function POST(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    return NextResponse.json(await updateAdminRecordDetails(parsed.data));
  } catch (error) {
    const message = error instanceof Error ? error.message : "保存记录详情失败";
    return NextResponse.json({ error: message }, { status: resolveRecordsErrorStatus(message) });
  }
}
