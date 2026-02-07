// worldcore/status/PostgresServerBuffService.ts

/**
 * IMPORTANT:
 * - Safe to import in unit tests.
 * - We lazy-import Database.ts to avoid opening sockets during `node --test`.
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

export type PersistedServerBuffRow = {
  id: string;
  name: string | null;
  effect_id: string;
  applied_at: string; // timestamptz
  expires_at: string | null; // timestamptz
  revoked_at: string | null; // timestamptz
  source_kind: string;
  source_id: string;
  modifiers: any;
  tags: string[] | null;
  max_stacks: number | null;
  initial_stacks: number | null;
};

export class PostgresServerBuffService {
  /**
   * List active (not revoked, not expired) buffs.
   */
  async listActive(nowMs: number = Date.now()): Promise<PersistedServerBuffRow[]> {
    if (isNodeTestRuntime()) return [];

    const db = await getDb();

    const nowIso = new Date(nowMs).toISOString();

    const res = await db.query(
      `
      SELECT
        id,
        name,
        effect_id,
        applied_at,
        expires_at,
        revoked_at,
        source_kind,
        source_id,
        modifiers,
        tags,
        max_stacks,
        initial_stacks
      FROM server_buffs
      WHERE revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > $1::timestamptz)
      ORDER BY applied_at ASC, id ASC
      `,
      [nowIso],
    );

    return res.rows as PersistedServerBuffRow[];
  }

  /**
   * Upsert a buff by logical id.
   * This is the canonical write for admin tools/events.
   */
  async upsert(input: {
    id: string;
    name?: string | null;
    effectId: string;
    appliedAtMs: number;
    expiresAtMs: number | null; // null means until removed
    sourceKind: string;
    sourceId: string;
    modifiers: any;
    tags?: string[] | null;
    maxStacks?: number | null;
    initialStacks?: number | null;
    createdBy?: string | null;
  }): Promise<void> {
    if (isNodeTestRuntime()) return;

    const db = await getDb();

    const appliedAt = new Date(input.appliedAtMs).toISOString();
    const expiresAt = input.expiresAtMs === null ? null : new Date(input.expiresAtMs).toISOString();

    await db.query(
      `
      INSERT INTO server_buffs (
        id,
        name,
        effect_id,
        applied_at,
        expires_at,
        revoked_at,
        source_kind,
        source_id,
        modifiers,
        tags,
        max_stacks,
        initial_stacks,
        created_by,
        revoked_by
      ) VALUES (
        $1,
        $2,
        $3,
        $4::timestamptz,
        $5::timestamptz,
        NULL,
        $6,
        $7,
        $8::jsonb,
        $9::text[],
        $10,
        $11,
        $12,
        NULL
      )
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        effect_id = EXCLUDED.effect_id,
        applied_at = EXCLUDED.applied_at,
        expires_at = EXCLUDED.expires_at,
        revoked_at = NULL,
        source_kind = EXCLUDED.source_kind,
        source_id = EXCLUDED.source_id,
        modifiers = EXCLUDED.modifiers,
        tags = EXCLUDED.tags,
        max_stacks = EXCLUDED.max_stacks,
        initial_stacks = EXCLUDED.initial_stacks,
        created_by = COALESCE(server_buffs.created_by, EXCLUDED.created_by),
        revoked_by = NULL
      `,
      [
        input.id,
        input.name ?? null,
        input.effectId,
        appliedAt,
        expiresAt,
        input.sourceKind,
        input.sourceId,
        JSON.stringify(input.modifiers ?? {}),
        (input.tags ?? null) as any,
        input.maxStacks ?? null,
        input.initialStacks ?? null,
        input.createdBy ?? null,
      ],
    );
  }

  /**
   * Revoke a single buff.
   */
  async revoke(id: string, revokedBy?: string | null, nowMs: number = Date.now()): Promise<boolean> {
    if (isNodeTestRuntime()) return false;

    const db = await getDb();

    const nowIso = new Date(nowMs).toISOString();

    const res = await db.query(
      `
      UPDATE server_buffs
      SET revoked_at = $2::timestamptz,
          revoked_by = $3
      WHERE id = $1
        AND revoked_at IS NULL
      `,
      [id, nowIso, revokedBy ?? null],
    );

    return (res.rowCount ?? 0) > 0;
  }

  /**
   * Revoke all buffs (admin safety lever).
   */
  async revokeAll(revokedBy?: string | null, nowMs: number = Date.now()): Promise<number> {
    if (isNodeTestRuntime()) return 0;

    const db = await getDb();
    const nowIso = new Date(nowMs).toISOString();

    const res = await db.query(
      `
      UPDATE server_buffs
      SET revoked_at = $1::timestamptz,
          revoked_by = $2
      WHERE revoked_at IS NULL
      `,
      [nowIso, revokedBy ?? null],
    );

    return res.rowCount ?? 0;
  }
}
