// worldcore/status/PostgresServerEventService.ts

/**
 * Server Events persistence (Postgres).
 *
 * IMPORTANT:
 * - Safe to import in unit tests.
 * - Lazy-import Database.ts to avoid opening sockets during `node --test`.
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

export type PersistedServerEventRow = {
  id: string;
  name: string;
  enabled: boolean;
  starts_at: string;
  ends_at: string | null;
  metadata: any;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

export type PersistedServerEventEffectRow = {
  id: number;
  event_id: string;
  effect_kind: string;
  payload: any;
  created_at: string;
  created_by: string | null;
};

export type ActiveServerEvent = PersistedServerEventRow & {
  effects: PersistedServerEventEffectRow[];
};

export class PostgresServerEventService {
  /**
   * List all events (admin tooling / debugging).
   */
  async listAll(): Promise<PersistedServerEventRow[]> {
    if (isNodeTestRuntime()) return [];

    const db = await getDb();
    const res = await db.query(
      `
      SELECT
        id,
        name,
        enabled,
        starts_at,
        ends_at,
        metadata,
        created_at,
        updated_at,
        created_by,
        updated_by
      FROM server_events
      ORDER BY starts_at ASC, id ASC
      `,
    );

    return (res.rows as PersistedServerEventRow[]) ?? [];
  }

  /**
   * List active (enabled + within time window) events with their effects.
   */
  async listActive(nowMs: number = Date.now()): Promise<ActiveServerEvent[]> {
    if (isNodeTestRuntime()) return [];

    const db = await getDb();
    const nowIso = new Date(nowMs).toISOString();

    const evRes = await db.query(
      `
      SELECT
        id,
        name,
        enabled,
        starts_at,
        ends_at,
        metadata,
        created_at,
        updated_at,
        created_by,
        updated_by
      FROM server_events
      WHERE enabled = TRUE
        AND starts_at <= $1::timestamptz
        AND (ends_at IS NULL OR ends_at > $1::timestamptz)
      ORDER BY starts_at ASC, id ASC
      `,
      [nowIso],
    );

    const events = (evRes.rows as PersistedServerEventRow[]) ?? [];
    if (events.length === 0) return [];

    const ids = events.map((e) => e.id);

    const fxRes = await db.query(
      `
      SELECT
        id,
        event_id,
        effect_kind,
        payload,
        created_at,
        created_by
      FROM server_event_effects
      WHERE event_id = ANY($1::text[])
      ORDER BY event_id ASC, id ASC
      `,
      [ids],
    );

    const byEvent = new Map<string, PersistedServerEventEffectRow[]>();
    for (const r of (fxRes.rows as PersistedServerEventEffectRow[]) ?? []) {
      const list = byEvent.get(r.event_id) ?? [];
      list.push(r);
      byEvent.set(r.event_id, list);
    }

    return events.map((e) => ({
      ...e,
      effects: byEvent.get(e.id) ?? [],
    }));
  }

  async upsertEvent(input: {
    id: string;
    name: string;
    enabled?: boolean;
    startsAtMs: number;
    endsAtMs?: number | null;
    metadata?: any;
    updatedBy?: string | null;
  }): Promise<void> {
    if (isNodeTestRuntime()) return;

    const db = await getDb();

    const startsAt = new Date(input.startsAtMs).toISOString();
    const endsAt = input.endsAtMs == null ? null : new Date(input.endsAtMs).toISOString();

    await db.query(
      `
      INSERT INTO server_events (
        id,
        name,
        enabled,
        starts_at,
        ends_at,
        metadata,
        created_by,
        updated_by
      ) VALUES (
        $1,
        $2,
        $3,
        $4::timestamptz,
        $5::timestamptz,
        $6::jsonb,
        $7,
        $7
      )
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        enabled = EXCLUDED.enabled,
        starts_at = EXCLUDED.starts_at,
        ends_at = EXCLUDED.ends_at,
        metadata = EXCLUDED.metadata,
        updated_by = EXCLUDED.updated_by
      `,
      [
        input.id,
        input.name,
        input.enabled ?? true,
        startsAt,
        endsAt,
        JSON.stringify(input.metadata ?? {}),
        input.updatedBy ?? null,
      ],
    );
  }

  async setEnabled(id: string, enabled: boolean, updatedBy?: string | null): Promise<boolean> {
    if (isNodeTestRuntime()) return false;

    const db = await getDb();

    const res = await db.query(
      `
      UPDATE server_events
      SET enabled = $2,
          updated_by = $3,
          updated_at = NOW()
      WHERE id = $1
      `,
      [id, enabled, updatedBy ?? null],
    );

    return (res.rowCount ?? 0) > 0;
  }

  async deleteEvent(id: string): Promise<boolean> {
    if (isNodeTestRuntime()) return false;

    const db = await getDb();

    // effects have ON DELETE CASCADE (recommended), but be safe.
    await db.query(`DELETE FROM server_event_effects WHERE event_id = $1`, [id]);

    const res = await db.query(`DELETE FROM server_events WHERE id = $1`, [id]);
    return (res.rowCount ?? 0) > 0;
  }

  async addEffect(input: {
    eventId: string;
    effectKind: string;
    payload?: any;
    createdBy?: string | null;
  }): Promise<number | null> {
    if (isNodeTestRuntime()) return null;

    const db = await getDb();

    const res = await db.query(
      `
      INSERT INTO server_event_effects (
        event_id,
        effect_kind,
        payload,
        created_by
      ) VALUES (
        $1,
        $2,
        $3::jsonb,
        $4
      )
      RETURNING id
      `,
      [input.eventId, input.effectKind, JSON.stringify(input.payload ?? {}), input.createdBy ?? null],
    );

    const id = (res.rows?.[0] as any)?.id;
    if (typeof id === "number") return id;
    const n = Number(id);
    return Number.isFinite(n) ? n : null;
  }

  async deleteEffect(effectId: number): Promise<boolean> {
    if (isNodeTestRuntime()) return false;

    const db = await getDb();

    const res = await db.query(`DELETE FROM server_event_effects WHERE id = $1`, [effectId]);
    return (res.rowCount ?? 0) > 0;
  }
}
