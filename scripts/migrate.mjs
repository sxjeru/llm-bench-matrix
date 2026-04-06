#!/usr/bin/env node
import "dotenv/config";
import { existsSync, readdirSync } from "node:fs";

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || "";

function printMissingDatabaseEnvError() {
  console.error(
    [
      "[migrate] Missing database connection string.",
      "[migrate] Set DATABASE_URL (preferred) or POSTGRES_URL in Vercel > Project > Settings > Environment Variables.",
      "[migrate] For Neon, use the Neon connection string; DATABASE_DRIVER=neon is optional because .neon.tech URLs are auto-detected.",
      "[migrate] The build script runs database migrations before Next.js builds, so deployment cannot continue until this is configured."
    ].join("\n")
  );
}

if (!connectionString) {
  printMissingDatabaseEnvError();
  process.exit(1);
}

const useNeon =
  process.env.DATABASE_DRIVER === "neon" ||
  (process.env.DATABASE_DRIVER !== "pg" && /\.neon\.tech/.test(connectionString));

const PG_SSL_QUERY_KEYS = [
  "ssl",
  "sslmode",
  "sslcert",
  "sslkey",
  "sslrootcert",
  "sslpassword",
  "sslaccept",
  "uselibpqcompat"
];

function normalizeEnvMultiline(value) {
  let normalized = value.trim();
  if (
    (normalized.startsWith('"') && normalized.endsWith('"')) ||
    (normalized.startsWith("'") && normalized.endsWith("'"))
  ) {
    normalized = normalized.slice(1, -1);
  }
  return normalized.replace(/\\n/g, "\n");
}

function stripPgSslParams(urlString) {
  try {
    const url = new URL(urlString);
    for (const key of PG_SSL_QUERY_KEYS) {
      url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return urlString;
  }
}

function getSSLOptions() {
  const ca = process.env.DATABASE_CA;
  if (!ca) return undefined;

  const normalized = normalizeEnvMultiline(ca);
  if (normalized.includes("-----BEGIN CERTIFICATE-----")) {
    return { ca: normalized, rejectUnauthorized: true };
  }

  const decoded = Buffer.from(normalized, "base64").toString("utf8").trim();
  const pem = normalizeEnvMultiline(decoded);
  return { ca: pem, rejectUnauthorized: true };
}

async function createMigrateContext() {
  if (useNeon) {
    const { Pool, neonConfig } = await import("@neondatabase/serverless");
    const { WebSocket } = await import("ws");
    neonConfig.webSocketConstructor = WebSocket;

    const { drizzle } = await import("drizzle-orm/neon-serverless");
    const { migrate } = await import("drizzle-orm/neon-serverless/migrator");

    const pool = new Pool({ connectionString });
    const db = drizzle(pool);

    return { pool, db, migrate, driver: "neon" };
  }

  const pg = await import("pg");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { migrate } = await import("drizzle-orm/node-postgres/migrator");

  const sslOptions = getSSLOptions();
  const pgConnectionString = sslOptions ? stripPgSslParams(connectionString) : connectionString;

  const pool = new pg.default.Pool({
    connectionString: pgConnectionString,
    ssl: sslOptions,
    max: Number.parseInt(process.env.DATABASE_POOL_MAX || "5", 10),
    idleTimeoutMillis: Number.parseInt(process.env.DATABASE_POOL_IDLE_TIMEOUT_MS || "10000", 10),
    connectionTimeoutMillis: Number.parseInt(process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS || "5000", 10),
    maxUses: Number.parseInt(process.env.DATABASE_POOL_MAX_USES || "7500", 10)
  });

  const db = drizzle(pool);
  return { pool, db, migrate, driver: "pg" };
}

async function runMigrations() {
  const migrationsFolder = "./drizzle";

  if (!existsSync(migrationsFolder)) {
    console.log("[migrate] drizzle folder not found, skip migrations.");
    return;
  }

  const sqlFiles = readdirSync(migrationsFolder).filter((f) => f.endsWith(".sql"));
  if (sqlFiles.length === 0) {
    console.log("[migrate] no migration sql found, skip migrations.");
    return;
  }

  const { pool, db, migrate, driver } = await createMigrateContext();
  try {
    console.log(`[migrate] start (driver: ${driver})`);
    await migrate(db, { migrationsFolder });
    console.log("[migrate] done");
  } finally {
    await pool.end();
  }
}

runMigrations().catch((error) => {
  console.error("[migrate] failed:", error);
  process.exit(1);
});
