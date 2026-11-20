export type LogLevel = "debug" | "info" | "warn" | "error";

/** The runtime serializer and TypeScript field types derive from this one schema. */
export const LOG_FIELD_SCHEMA = {
  strings: [
    "requestId",
    "method",
    "path",
    "errorName",
    "errorCode",
    "routerKind",
    "routeType",
    "snapshotSource",
    "fallbackSource",
    "cacheStatus"
  ],
  numbers: [
    "statusCode",
    "durationMs",
    "attempt",
    "payloadBytes",
    "recordCount",
    "warningCount",
    "changedCount",
    "changedModelCount",
    "providerCount",
    "sourceModelCount",
    "matchedCount",
    "unmatchedCount",
    "skippedManualCount",
    "skippedCount"
  ],
  booleans: ["slow", "fallbackUsed", "dryRun"]
} as const;

type StringLogField = typeof LOG_FIELD_SCHEMA.strings[number];
type NumberLogField = typeof LOG_FIELD_SCHEMA.numbers[number];
type BooleanLogField = typeof LOG_FIELD_SCHEMA.booleans[number];

export type LogFields = Readonly<
  Partial<Record<StringLogField, string>>
  & Partial<Record<NumberLogField, number>>
  & Partial<Record<BooleanLogField, boolean>>
>;

type RequestLogContext = Readonly<{
  requestId: string;
  method: string;
  path: string;
}>;

const LEVEL_SEVERITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

const STRING_LOG_FIELDS = new Set<string>(LOG_FIELD_SCHEMA.strings);
const NUMBER_LOG_FIELDS = new Set<string>(LOG_FIELD_SCHEMA.numbers);
const BOOLEAN_LOG_FIELDS = new Set<string>(LOG_FIELD_SCHEMA.booleans);

function configuredLevel(): LogLevel {
  const configured = process.env.LOG_LEVEL?.trim().toLowerCase();
  if (configured === "debug" || configured === "info" || configured === "warn" || configured === "error") {
    return configured;
  }

  return process.env.NODE_ENV === "development" ? "debug" : "info";
}

function getString(value: unknown, maxLength = 160): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.replace(/[\r\n\t\u2028\u2029]/g, " ").trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
}

function serializeFields(fields: LogFields): Record<string, string | number | boolean> {
  const serialized: Record<string, string | number | boolean> = {};

  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;

    if (NUMBER_LOG_FIELDS.has(key)) {
      if (typeof value === "number" && Number.isFinite(value)) serialized[key] = Math.round(value * 100) / 100;
      continue;
    }

    if (BOOLEAN_LOG_FIELDS.has(key)) {
      if (typeof value === "boolean") serialized[key] = value;
      continue;
    }

    const stringValue = getString(value, key === "path" ? 300 : 160);
    if (stringValue && STRING_LOG_FIELDS.has(key)) {
      serialized[key] = stringValue;
    }
  }

  return serialized;
}

export function log(level: LogLevel, event: string, fields: LogFields = {}): void {
  if (LEVEL_SEVERITY[level] < LEVEL_SEVERITY[configuredLevel()]) return;

  const safeEvent = /^[a-zA-Z0-9_.:-]{1,120}$/.test(event) ? event : "application.event";
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    event: safeEvent,
    ...serializeFields(fields)
  });

  if (level === "error") console.error(entry);
  else if (level === "warn") console.warn(entry);
  else if (level === "debug") console.debug(entry);
  else console.info(entry);
}

export function getErrorFields(error: unknown): Pick<LogFields, "errorName" | "errorCode"> {
  if (!(error instanceof Error)) return { errorName: "NonErrorThrown" };

  const errorName = getString(error.name, 80);
  const code = (error as Error & { code?: unknown }).code;
  const errorCode = typeof code === "string" && /^[A-Z0-9_-]{1,32}$/i.test(code) ? code : undefined;

  return {
    ...(errorName ? { errorName } : {}),
    ...(errorCode ? { errorCode } : {})
  };
}

const REQUEST_ID_FOR_ERROR = Symbol.for("bench-matrix.request-id");
const requestIdsByError = new WeakMap<Error, string>();

/** Keep the API request ID attached to an exception for Next's later error hook. */
export function associateErrorWithRequestId(error: unknown, requestId: string): void {
  if (!(error instanceof Error)) return;
  requestIdsByError.set(error, requestId);

  try {
    Object.defineProperty(error, REQUEST_ID_FOR_ERROR, {
      configurable: true,
      value: requestId
    });
  } catch {
    // Frozen errors still get logged; the framework hook can use the Vercel ID.
  }
}

export function getErrorRequestId(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  let requestId: unknown = requestIdsByError.get(error);
  if (requestId === undefined) {
    try {
      requestId = Reflect.get(error, REQUEST_ID_FOR_ERROR);
    } catch {
      return undefined;
    }
  }
  return typeof requestId === "string" && /^[a-zA-Z0-9:._-]{1,128}$/.test(requestId)
    ? requestId
    : undefined;
}

/**
 * Emit a stable, structured event without collecting request bodies, credentials,
 * headers, query strings, IP addresses, or database error messages.
 */
export function logError(event: string, error: unknown, fields: LogFields = {}): void {
  log("error", event, {
    ...fields,
    ...getErrorFields(error)
  });
}

export function createRequestLogContext(request: Request): RequestLogContext {
  const vercelRequestId = request.headers.get("x-vercel-id");
  const safeRequestId = vercelRequestId && /^[a-zA-Z0-9:._-]{1,128}$/.test(vercelRequestId)
    ? vercelRequestId
    : crypto.randomUUID();

  let path = "/";
  try {
    path = new URL(request.url).pathname.slice(0, 300) || "/";
  } catch {
    // The path has no query string or credentials; use the safe root fallback.
  }

  return {
    requestId: safeRequestId,
    method: getString(request.method.toUpperCase(), 16) ?? "UNKNOWN",
    path
  };
}
