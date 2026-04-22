import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "../../../../../lib/admin-auth";
import {
  getProviderPrefixRules,
  upsertProviderConfig,
  HEX_COLOR_REGEX
} from "../../../../../lib/db/queries";
import { db } from "../../../../../lib/db/client";
import { providers } from "../../../../../lib/db/schema";

export async function GET(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const [providerRows, prefixRules] = await Promise.all([
    db.select().from(providers).orderBy(providers.name),
    getProviderPrefixRules()
  ]);

  const rulesByProvider = new Map<number, typeof prefixRules>();
  for (const rule of prefixRules) {
    if (!rulesByProvider.has(rule.providerId)) {
      rulesByProvider.set(rule.providerId, []);
    }
    rulesByProvider.get(rule.providerId)!.push(rule);
  }

  const result = providerRows.map((p) => ({
    id: p.id,
    name: p.name,
    slug: p.slug,
    displayName: p.displayName ?? null,
    brandColor: p.brandColor ?? null,
    brandTextColor: p.brandTextColor ?? null,
    prefixRules: rulesByProvider.get(p.id) ?? []
  }));

  return NextResponse.json({ providers: result });
}

const updateSchema = z.object({
  providerId: z.number().int().positive(),
  displayName: z.string().nullable().optional(),
  brandColor: z
    .string()
    .nullable()
    .optional()
    .refine(
      (v) => v == null || v === "" || HEX_COLOR_REGEX.test(v),
      { message: "brandColor must be a valid hex color (e.g. #10a37f)" }
    ),
  brandTextColor: z
    .string()
    .nullable()
    .optional()
    .refine(
      (v) => v == null || v === "" || HEX_COLOR_REGEX.test(v),
      { message: "brandTextColor must be a valid hex color" }
    )
});

export async function PUT(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { providerId, displayName, brandColor, brandTextColor } = parsed.data;

  try {
    await upsertProviderConfig(providerId, {
      displayName: displayName ?? null,
      brandColor: brandColor ?? null,
      brandTextColor: brandTextColor ?? null
    });
  } catch (error) {
    const statusCode = (error as { statusCode?: number }).statusCode ?? 500;
    const message = error instanceof Error ? error.message : "unknown error";
    return NextResponse.json({ error: message }, { status: statusCode });
  }

  return NextResponse.json({ ok: true });
}
