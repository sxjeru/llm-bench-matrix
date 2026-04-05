import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "../../../../lib/admin-auth";
import { deleteMergedEntityRecord, updateMergedEntityRecord } from "../../../../lib/admin-service";

const updateSchema = z.object({
  entityType: z.enum(["model", "benchmark"]),
  sourceId: z.number().int().positive(),
  targetId: z.number().int().positive()
});

const deleteSchema = z.object({
  entityType: z.enum(["model", "benchmark"]),
  sourceId: z.number().int().positive()
});

export async function PATCH(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const result = await updateMergedEntityRecord(parsed.data);
  return NextResponse.json(result);
}

export async function DELETE(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const parsed = deleteSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const result = await deleteMergedEntityRecord(parsed.data);
  return NextResponse.json(result);
}
