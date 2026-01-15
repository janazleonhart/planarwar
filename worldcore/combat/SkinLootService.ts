// worldcore/combat/SkinLootService.ts
//
// DB-backed skinning loot profiles (v1).
//
// Design goals:
// - Prefer DB so content can evolve without code edits.
// - Keep server resilient: if tables/columns aren't applied yet, fall back safely.
// - Unit tests run with WORLDCORE_TEST=1 which disables DB access; service must not brick tests.

import { db } from "../db/Database";
import { Logger } from "../utils/logger";

export type SkinLootEntry = {
  itemId: string;
  chance: number; // 0..1
  minQty: number;
  maxQty: number;
  priority: number; // lower = earlier
};

type SkinLootRow = {
  npc_proto_id: string | null;
  npc_tag: string | null;
  item_id: string;
  chance: number | null;
  min_qty: number | null;
  max_qty: number | null;
  priority: number | null;
};

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function toNum(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export class SkinLootService {
  private log = Logger.scope("SkinLoot");
  private loaded = false;

  private byProto = new Map<string, SkinLootEntry[]>();
  private byTag = new Map<string, SkinLootEntry[]>();

  private async loadIfNeeded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;

    try {
      // NOTE: db.query is effectively `any` under WORLDCORE_TEST mode (it's a stub),
      // so we cannot use generic type args here without tripping TS2347.
      const r = (await (db as any).query(`
        SELECT
          npc_proto_id,
          npc_tag,
          item_id,
          chance,
          min_qty,
          max_qty,
          priority
        FROM skin_loot
        ORDER BY priority ASC, item_id ASC
      `)) as { rows?: unknown[]; rowCount?: number } | undefined;

      const rows = (r?.rows ?? []) as SkinLootRow[];

      this.byProto.clear();
      this.byTag.clear();

      for (const row of rows) {
        const entry: SkinLootEntry = {
          itemId: String(row.item_id),
          chance: clamp01(toNum(row.chance, 1)),
          minQty: Math.max(1, toNum(row.min_qty, 1)),
          maxQty: Math.max(1, toNum(row.max_qty, 1)),
          priority: toNum(row.priority, 100),
        };

        if (entry.maxQty < entry.minQty) entry.maxQty = entry.minQty;

        if (row.npc_proto_id) {
          const key = String(row.npc_proto_id);
          const arr = this.byProto.get(key) ?? [];
          arr.push(entry);
          this.byProto.set(key, arr);
        }

        if (row.npc_tag) {
          const key = String(row.npc_tag);
          const arr = this.byTag.get(key) ?? [];
          arr.push(entry);
          this.byTag.set(key, arr);
        }
      }

      // Keep deterministic ordering.
      for (const arr of this.byProto.values())
        arr.sort((a, b) => a.priority - b.priority || a.itemId.localeCompare(b.itemId));
      for (const arr of this.byTag.values())
        arr.sort((a, b) => a.priority - b.priority || a.itemId.localeCompare(b.itemId));

      this.log.info("Loaded skin loot profiles", {
        protos: this.byProto.size,
        tags: this.byTag.size,
        rows: r?.rowCount ?? rows.length,
      });
    } catch (err: any) {
      // If tables/columns aren't applied yet, don't brick the server/tools.
      this.byProto.clear();
      this.byTag.clear();
      this.log.warn("Failed to load skin_loot table; using fallback skin loot", {
        err: String(err?.message ?? err),
      });
    }
  }

  /**
   * Returns ordered loot entries for a given NPC proto + its tags.
   *
   * Resolution order:
   *  1) Explicit npc_proto_id rows
   *  2) npc_tag rows (merged, de-duped by itemId)
   *
   * If the DB isn't known/applied, returns [] and callers should fall back.
   */
  async getEntries(protoId: string, tags: string[]): Promise<SkinLootEntry[]> {
    await this.loadIfNeeded();

    const out: SkinLootEntry[] = [];
    const seen = new Set<string>();

    const protoArr = this.byProto.get(protoId) ?? [];
    for (const e of protoArr) {
      if (seen.has(e.itemId)) continue;
      out.push(e);
      seen.add(e.itemId);
    }

    for (const t of tags) {
      const tagArr = this.byTag.get(t) ?? [];
      for (const e of tagArr) {
        if (seen.has(e.itemId)) continue;
        out.push(e);
        seen.add(e.itemId);
      }
    }

    out.sort((a, b) => a.priority - b.priority || a.itemId.localeCompare(b.itemId));
    return out;
  }
}

let _svc: SkinLootService | null = null;

export function getSkinLootService(): SkinLootService {
  if (!_svc) _svc = new SkinLootService();
  return _svc;
}
