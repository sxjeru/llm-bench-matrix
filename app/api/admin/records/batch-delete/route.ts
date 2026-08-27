import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-auth";
import { batchDeleteRecords } from "@/lib/admin-records-service";
import { resolveRecordsErrorStatus } from "../error-status";

const schema = z.object({
  scope: z
    .object({
      modelIds: z.array(z.number().int().positive()).max(500).optional(),
      benchmarkIds: z.array(z.number().int().positive()).max(500).optional(),
      sourceMode: z.enum(["all", "specific", "empty"]).optional(),
      source: z.string().max(200).nullable().optional()
    })
    .optional(),
  allowUnfiltered: z.boolean().optional()
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
    const result = await batchDeleteRecords(parsed.data);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "批量删除失败";
    return NextResponse.json({ error: message }, { status: resolveRecordsErrorStatus(message) });
  }
}
