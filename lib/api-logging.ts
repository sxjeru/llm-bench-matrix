import { createRequestLogContext, getErrorFields, log, type LogFields, type LogLevel } from "@/lib/logger";

export function logApiEvent(request: Request, level: LogLevel, event: string, fields: LogFields = {}): void {
  log(level, event, {
    ...fields,
    ...createRequestLogContext(request)
  });
}

export function logApiError(request: Request, event: string, error: unknown, fields: LogFields = {}): void {
  logApiEvent(request, "error", event, {
    ...fields,
    ...getErrorFields(error)
  });
}

/** Log each executed API invocation; CDN cache hits never reach the handler. */
export async function withApiLogging(
  request: Request,
  event: string,
  handler: () => Response | Promise<Response>
): Promise<Response> {
  const context = createRequestLogContext(request);
  const startedAt = performance.now();
  const slowThreshold = Number(process.env.LOG_SLOW_REQUEST_MS);
  const slowThresholdMs = Number.isFinite(slowThreshold) && slowThreshold > 0 ? slowThreshold : 1000;

  const response = await handler();
  const durationMs = Math.round((performance.now() - startedAt) * 100) / 100;
  const slow = durationMs >= slowThresholdMs;
  const statusLevel = response.status >= 500 ? "error" : response.status >= 400 || slow ? "warn" : "info";

  log(statusLevel, event, {
    ...context,
    statusCode: response.status,
    durationMs,
    ...(slow ? { slow: true } : {})
  });

  return response;
}
