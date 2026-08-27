import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-auth";
import { getAdminRecordSourceEntities } from "@/lib/admin-records-service";
import { resolveRecordsErrorStatus } from "../error-status";

const sourceModeSchema = z.enum(["specific", "empty"]);

export async function GET(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const url = new URL(request.url);
  const sourceMode = sourceModeSchema.safeParse(url.searchParams.get("sourceMode"));

  if (!sourceMode.success) {
    return NextResponse.json({ error: "sourceMode 只能是 specific / empty" }, { status: 400 });
  }

  try {
    const result = await getAdminRecordSourceEntities({
      sourceMode: sourceMode.data,
      source: url.searchParams.get("source")
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "加载 Source 实体范围失败";
    return NextResponse.json({ error: message }, { status: resolveRecordsErrorStatus(message) });
  }
}
