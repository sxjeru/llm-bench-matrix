import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "../../../../../../lib/admin-auth";
import { updateProviderPrefixRule, deleteProviderPrefixRule } from "../../../../../../lib/db/queries";

const updateSchema = z.object({
  prefix: z.string().min(1).optional(),
  priority: z.number().int().optional(),
  isEnabled: z.boolean().optional()
});

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const { id: rawId } = await params;
  const ruleId = Number(rawId);
  if (!Number.isInteger(ruleId) || ruleId <= 0) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const rule = await updateProviderPrefixRule(ruleId, parsed.data);
    return NextResponse.json({ rule });
  } catch (error) {
    const statusCode = (error as { statusCode?: number }).statusCode ?? 500;
    const message = error instanceof Error ? error.message : "unknown error";
    return NextResponse.json({ error: message }, { status: statusCode });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const { id: rawId } = await params;
  const ruleId = Number(rawId);
  if (!Number.isInteger(ruleId) || ruleId <= 0) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  try {
    await deleteProviderPrefixRule(ruleId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const statusCode = (error as { statusCode?: number }).statusCode ?? 500;
    const message = error instanceof Error ? error.message : "unknown error";
    return NextResponse.json({ error: message }, { status: statusCode });
  }
}
