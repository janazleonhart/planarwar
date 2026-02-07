// worldcore/status/PostgresServerKvService.ts

/**
 * Persisted global server knobs (JSONB KV).
 *
 * This is intentionally tiny. Use it for:
 *  - feature flags
 *  - global multipliers
 *  - event metadata
 *  - donation/community progress counters
 *
 * IMPORTANT:
 * - Safe to import in unit tests.
 * - Lazy DB import avoids open handles during `node --test`.
 */
function isNodeTestRuntime(): boolean {
  return (
    process.execArgv.includes("--test") ||
    process.argv.includes("--test") ||
    process.env.NODE_ENV === "test" ||
    process.env.WORLDCORE_TEST === "1"
  );
}

async function getDb(): Promise<any> {
  const mod: any = await import("../db/Database");
  return mod.db;
}

export class PostgresServerKvService {
  /**
   * List keys matching a prefix.
   *
   * Intended for small namespaces like `event.*` so the server can
   * reconcile and clean up per-event derived keys.
   */
  async listKeysByPrefix(prefix: string): Promise<string[]> {
    if (isNodeTestRuntime()) return [];

    const p = String(prefix ?? "");
    if (!p) return [];

    // Escape LIKE wildcards in the prefix.
    const escaped = p.replace(/[\%_]/g, (m) => "\\" + m);

    const db = await getDb();
    const res = await db.query(
      `
      SELECT key
      FROM server_kv
      WHERE key LIKE $1
      ORDER BY key ASC
      `,
      [escaped + "%"],
    );

    return ((res.rows ?? []) as any[]).map((r) => String(r.key));
  }

  async get<T = any>(key: string): Promise<T | undefined> {
    if (isNodeTestRuntime()) return undefined;

    const db = await getDb();
    const res = await db.query(
      `
      SELECT value
      FROM server_kv
      WHERE key = $1
      `,
      [key],
    );

    const row = res.rows?.[0] as any;
    return row?.value as T | undefined;
  }

  async set(key: string, value: any, updatedBy?: string | null): Promise<void> {
    if (isNodeTestRuntime()) return;

    const db = await getDb();
    await db.query(
      `
      INSERT INTO server_kv (key, value, updated_at, updated_by)
      VALUES ($1, $2::jsonb, NOW(), $3)
      ON CONFLICT (key) DO UPDATE SET
        value = EXCLUDED.value,
        updated_at = NOW(),
        updated_by = EXCLUDED.updated_by
      `,
      [key, JSON.stringify(value ?? null), updatedBy ?? null],
    );
  }

  async delete(key: string): Promise<boolean> {
    if (isNodeTestRuntime()) return false;

    const db = await getDb();
    const res = await db.query(
      `
      DELETE FROM server_kv
      WHERE key = $1
      `,
      [key],
    );

    return (res.rowCount ?? 0) > 0;
  }
}
