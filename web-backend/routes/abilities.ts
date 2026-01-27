// web-backend/routes/abilities.ts
//
// Abilities metadata endpoint.
//
// Supports:
//   GET /api/abilities?classId=warrior&level=8
//     -> returns unlocked abilities for that class at that level (from DB ability_unlocks)
//
//   GET /api/abilities?ids=power_strike,savage_strike
//     -> returns metadata for the requested ability ids (best-effort)
//
// The route tries to enrich rows using worldcore ability definitions when present.

import express, { type Request, type Response } from "express";
import { Pool } from "pg";

// Best-effort enrichment from worldcore definitions.
// NOTE: not all DB ability_ids necessarily have a code definition yet.
// This route will still return a row with name=id when missing.
import { ABILITIES } from "../../worldcore/abilities/AbilityTypes";

type AbilityUnlockRow = {
  class_id: string;
  ability_id: string;
  min_level: number;
  auto_grant: boolean;
  is_enabled: boolean;
  notes: string | null;
};

export type AbilityMetaRow = {
  id: string;
  name: string;
  description: string | null;
  classId?: string;
  minLevel?: number;
  autoGrant?: boolean;
  isEnabled?: boolean;
  cooldownMs?: number | null;
  // For debugging / future UI.
  rawId?: string;
  notes?: string | null;
};

function parseCsvParam(v: unknown): string[] {
  if (typeof v !== "string") return [];
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function toInt(v: unknown): number | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : null;
}

function enrichFromWorldcore(id: string): Pick<AbilityMetaRow, "id" | "name" | "description" | "cooldownMs"> {
  const def: any = (ABILITIES as any)[id];
  return {
    id,
    name: def?.name ?? id,
    description: def?.description ?? null,
    cooldownMs: typeof def?.cooldownMs === "number" ? def.cooldownMs : null,
  };
}

const router = express.Router();

const db = new Pool({
  host: process.env.PGHOST || "127.0.0.1",
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || "planarwar",
  password: process.env.PGPASSWORD || "planarwar",
  database: process.env.PGDATABASE || "planarwar_main",
});

router.get("/", async (req: Request, res: Response) => {
  try {
    const ids = parseCsvParam(req.query.ids);
    const classId = typeof req.query.classId === "string" ? req.query.classId.trim() : "";
    const level = toInt(req.query.level);

    // (A) Direct lookup by ids (no DB required).
    if (ids.length > 0) {
      const abilities: AbilityMetaRow[] = ids.map((id) => ({
        ...enrichFromWorldcore(id),
        rawId: id,
      }));
      return res.json({ abilities });
    }

    // (B) Unlock lookup by class+level (DB-driven).
    if (classId && level !== null) {
      const q = `
        SELECT class_id, ability_id, min_level, auto_grant, is_enabled, notes
          FROM public.ability_unlocks
         WHERE class_id = $1
           AND is_enabled = true
           AND min_level <= $2
         ORDER BY min_level ASC, ability_id ASC;
      `;

      const qres = await db.query(q, [classId, level]);
      const rows = qres.rows as AbilityUnlockRow[];

      const abilities: AbilityMetaRow[] = rows.map((r) => {
        const base = enrichFromWorldcore(String(r.ability_id));
        return {
          ...base,
          classId: String(r.class_id),
          minLevel: Number(r.min_level),
          autoGrant: Boolean(r.auto_grant),
          isEnabled: Boolean(r.is_enabled),
          notes: r.notes ?? null,
          rawId: String(r.ability_id),
        };
      });

      return res.json({ abilities });
    }

    // (C) Nothing supplied.
    return res.status(400).json({
      ok: false,
      error: "Provide either ids=... or classId=...&level=...",
    });
  } catch (err: any) {
    console.error("[abilities] error", err);
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

export default router;
