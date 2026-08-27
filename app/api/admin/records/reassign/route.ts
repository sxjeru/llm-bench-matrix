import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-auth";
import {
  reassignRecordBenchmark,
  reassignRecordModel,
  reassignRecordSource
} from "@/lib/admin-records-service";
import { resolveRecordsErrorStatus } from "../error-status";

const scopeSchema = z
  .object({
    modelIds: z.array(z.number().int().positive()).max(500).optional(),
    benchmarkIds: z.array(z.number().int().positive()).max(500).optional(),
    sourceMode: z.enum(["all", "specific", "empty"]).optional(),
    source: z.string().max(200).nullable().optional()
  })
  .optional();

const conflictStrategySchema = z.enum(["skip", "overwrite", "keep-both"]).optional();

const schema = z.discriminatedUnion("entityType", [
  z.object({
    entityType: z.literal("benchmark"),
    fromBenchmarkId: z.number().int().positive(),
    target: z
      .object({
        benchmarkId: z.number().int().positive().optional(),
        benchmarkName: z.string().trim().max(200).optional(),
        benchmarkType: z.string().trim().max(100).optional()
      })
      .refine(
        (value) => typeof value.benchmarkId === "number" || Boolean(value.benchmarkName?.trim()),
        { message: "target 需要给出 benchmarkId 或 benchmarkName" }
      ),
    scope: scopeSchema,
    conflictStrategy: conflictStrategySchema
  }),
  z.object({
    entityType: z.literal("model"),
    fromModelId: z.number().int().positive(),
    target: z
      .object({
        modelId: z.number().int().positive().optional(),
        modelName: z.string().trim().max(200).optional(),
        providerName: z.string().trim().max(200).optional()
      })
      .refine((value) => typeof value.modelId === "number" || Boolean(value.modelName?.trim()), {
        message: "target 需要给出 modelId 或 modelName"
      }),
    scope: scopeSchema,
    conflictStrategy: conflictStrategySchema
  }),
  z.object({
    entityType: z.literal("source"),
    fromSource: z.string().max(200).nullable(),
    toSource: z.string().max(200).nullable(),
    scope: scopeSchema
  })
]);

export async function POST(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    if (parsed.data.entityType === "benchmark") {
      const result = await reassignRecordBenchmark({
        fromBenchmarkId: parsed.data.fromBenchmarkId,
        target: parsed.data.target,
        scope: parsed.data.scope,
        conflictStrategy: parsed.data.conflictStrategy
      });
      return NextResponse.json(result);
    }

    if (parsed.data.entityType === "model") {
      const result = await reassignRecordModel({
        fromModelId: parsed.data.fromModelId,
        target: parsed.data.target,
        scope: parsed.data.scope,
        conflictStrategy: parsed.data.conflictStrategy
      });
      return NextResponse.json(result);
    }

    const result = await reassignRecordSource({
      fromSource: parsed.data.fromSource,
      toSource: parsed.data.toSource,
      scope: parsed.data.scope
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "变更归属失败";
    return NextResponse.json({ error: message }, { status: resolveRecordsErrorStatus(message) });
  }
}
