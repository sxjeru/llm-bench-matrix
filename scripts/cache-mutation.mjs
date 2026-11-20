import { randomUUID } from "node:crypto";

/** Standalone scripts cannot import Next/TypeScript; keep the same commit contract. */
export async function withCacheVersionTransaction(pool, domains, write) {
  const connection = await pool.connect();
  try {
    await connection.query("BEGIN");
    const result = await write(connection);
    const changed = [...new Set(typeof domains === "function" ? domains(result) : domains)].sort();
    if (changed.length > 0) {
      const keys = changed.map((domain) => `cache_version:${domain}`);
      const values = changed.map(() => JSON.stringify({ version: `${Date.now()}:${randomUUID()}` }));
      await connection.query(`
        INSERT INTO settings (key, value_json, updated_at, updated_by, note)
        SELECT key, value::jsonb, now(), 'cache-system', 'Cache version'
          FROM unnest($1::text[], $2::text[]) AS versions(key, value)
        ON CONFLICT (key) DO UPDATE SET
          value_json = excluded.value_json, updated_at = excluded.updated_at,
          updated_by = excluded.updated_by, note = excluded.note
      `, [keys, values]);
    }
    await connection.query("COMMIT");
    return result;
  } catch (error) {
    await connection.query("ROLLBACK");
    throw error;
  } finally {
    connection.release();
  }
}
