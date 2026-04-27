import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "../../../../lib/admin-auth";
import { ensureProvider, updateProviderConfig } from "../../../../lib/admin-service";

const schema = z.object({
  name: z.string().min(1)
});

const nullableNonEmptyString = z.string().trim().min(1).nullable();
const nullableHexColor = z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).nullable();

const providerConfigSchema = z.object({
  displayName: nullableNonEmptyString.optional(),
  prefixRules: z.array(
    z.object({
      prefix: z.string().trim().min(1),
      enabled: z.boolean(),
      priority: z.number().int().optional(),
      note: z.string().trim().min(1).optional()
    })
  ).optional(),
  branding: z.object({
    color: nullableHexColor.optional()
  }).optional()
});

const patchSchema = z.object({
  providerId: z.number().int().positive(),
  config: providerConfigSchema
});

export async function POST(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const provider = await ensureProvider(parsed.data.name);
  return NextResponse.json({ provider });
}

export async function PATCH(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const provider = await updateProviderConfig(parsed.data);
    return NextResponse.json({ provider });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "更新 provider 配置失败" },
      { status: 400 }
    );
  }
}
