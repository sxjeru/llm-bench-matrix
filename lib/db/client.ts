import { Pool as NeonPool, neonConfig } from "@neondatabase/serverless";
import { drizzle as neonDrizzle } from "drizzle-orm/neon-serverless";
import { drizzle as pgDrizzle } from "drizzle-orm/node-postgres";
import { Pool as PgPool } from "pg";
import { WebSocket } from "ws";
import { getConnectionString, shouldUseNeon } from "@/lib/db/driver";
import * as schema from "@/lib/db/schema";
import { getSslOptions, stripPgSslParams } from "@/lib/db/ssl";

function parseIntEnv(name: string, fallback: number, min = 0): number {
  const raw = process.env[name];
  if (!raw) return fallback;

  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value) || value < min) return fallback;

  return value;
}

const connectionString = getConnectionString();

if (!connectionString && process.env.NODE_ENV !== "test") {
  console.warn("[db] DATABASE_URL is empty, runtime queries will fail until env is set.");
}

function createDb() {
  if (!connectionString) {
    throw new Error("DATABASE_URL (or POSTGRES_URL) is missing");
  }

  const useNeon = shouldUseNeon(connectionString);

  if (useNeon) {
    neonConfig.webSocketConstructor = WebSocket;
    const pool = new NeonPool({ connectionString });
    return neonDrizzle(pool, { schema });
  }

  const sslOptions = getSslOptions();
  const pgConnectionString = sslOptions ? stripPgSslParams(connectionString) : connectionString;

  const pool = new PgPool({
    connectionString: pgConnectionString,
    ssl: sslOptions,
    max: parseIntEnv("DATABASE_POOL_MAX", 5, 1),
    idleTimeoutMillis: parseIntEnv("DATABASE_POOL_IDLE_TIMEOUT_MS", 10_000, 0),
    connectionTimeoutMillis: parseIntEnv("DATABASE_POOL_CONNECTION_TIMEOUT_MS", 5_000, 0),
    maxUses: parseIntEnv("DATABASE_POOL_MAX_USES", 7_500, 0)
  });

  return pgDrizzle(pool, { schema });
}

export const db = createDb();
