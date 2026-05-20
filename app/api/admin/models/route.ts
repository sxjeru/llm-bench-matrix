import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "../../../../lib/admin-auth";
import { ensureModelByProviderId } from "../../../../lib/admin-service";
import { invalidateAllCaches } from "../../../../lib/db/queries";

const schema = z.object({
  providerId: z.number().int().positive(),
  modelName: z.string().min(1),
  modelAlias: z.string().optional(),
  sourceModelId: z.string().optional()
});

export async function POST(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const model = await ensureModelByProviderId({
    providerId: parsed.data.providerId,
    modelName: parsed.data.modelName,
    modelAlias: parsed.data.modelAlias,
    sourceModelId: parsed.data.sourceModelId
  });

  invalidateAllCaches();
  return NextResponse.json({ model });
}
