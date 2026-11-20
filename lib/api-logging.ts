import {
  associateErrorWithRequestId,
  createRequestLogContext,
  getErrorFields,
  log,
  type LogFields,
  type LogLevel
} from "@/lib/logger";

type RequestLogContext = ReturnType<typeof createRequestLogContext>;

const activeRequestContexts = new WeakMap<Request, RequestLogContext>();

function getApiRequestContext(request: Request): RequestLogContext {
  return activeRequestContexts.get(request) ?? createRequestLogContext(request);
}

export function logApiEvent(request: Request, level: LogLevel, event: string, fields: LogFields = {}): void {
  log(level, event, {
    ...fields,
    ...getApiRequestContext(request)
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
  const existingContext = activeRequestContexts.get(request);
  const context = existingContext ?? createRequestLogContext(request);
  if (!existingContext) activeRequestContexts.set(request, context);

  const startedAt = performance.now();
  const slowThreshold = Number(process.env.LOG_SLOW_REQUEST_MS);
  const slowThresholdMs = Number.isFinite(slowThreshold) && slowThreshold > 0 ? slowThreshold : 1000;

  try {
    let response: Response;
    try {
      response = await handler();
    } catch (error) {
      const durationMs = Math.round((performance.now() - startedAt) * 100) / 100;
      const slow = durationMs >= slowThresholdMs;
      associateErrorWithRequestId(error, context.requestId);
      log("error", `${event}.exception`, {
        ...context,
        statusCode: 500,
        durationMs,
        ...(slow ? { slow: true } : {}),
        ...getErrorFields(error)
      });
      throw error;
    }

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
  } finally {
    if (!existingContext) activeRequestContexts.delete(request);
  }
}
