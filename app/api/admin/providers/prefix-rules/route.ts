import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "../../../../../lib/admin-auth";
import { addProviderPrefixRule } from "../../../../../lib/db/queries";

const schema = z.object({
  providerId: z.number().int().positive(),
  prefix: z.string().min(1),
  priority: z.number().int().optional(),
  isEnabled: z.boolean().optional()
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
    const rule = await addProviderPrefixRule(parsed.data);
    return NextResponse.json({ rule }, { status: 201 });
  } catch (error) {
    const statusCode = (error as { statusCode?: number }).statusCode ?? 500;
    const message = error instanceof Error ? error.message : "unknown error";
    return NextResponse.json({ error: message }, { status: statusCode });
  }
}
