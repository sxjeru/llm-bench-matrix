import { NextResponse } from "next/server";
import { getDashboardRows } from "@/lib/db/queries";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limitRaw = Number.parseInt(url.searchParams.get("limit") || "300", 10);
  const limit = Number.isNaN(limitRaw) ? 300 : Math.max(1, Math.min(1000, limitRaw));

  const rows = await getDashboardRows(limit);
  return NextResponse.json({ rows });
}
