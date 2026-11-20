type CacheDomain = "dashboard" | "pricing" | "admin_entities" | "settings";
export type ScriptConnection = {
  query(text: string, params?: unknown[]): Promise<unknown>;
  release(): void;
};
export function withCacheVersionTransaction<T>(
  pool: { connect(): Promise<ScriptConnection> },
  domains: CacheDomain[] | ((result: T) => CacheDomain[]),
  write: (connection: ScriptConnection) => Promise<T>
): Promise<T>;
