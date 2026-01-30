//web-backend/routes/characters.ts

import { Router, Request } from "express";
import { z } from "zod";

import { Logger } from "../../worldcore/utils/logger";
import { PostgresAuthService } from "../../worldcore/auth/PostgresAuthService";
import { PostgresCharacterService } from "../../worldcore/characters/PostgresCharacterService";
import type { CharacterSummary, CharacterState } from "../../worldcore/characters/CharacterTypes";

const log = Logger.scope("CHARACTERS");
const router = Router();

const auth = new PostgresAuthService();
const characters = new PostgresCharacterService();

const createCharacterSchema = z.object({
  shardId: z.string().min(1).optional(),
  name: z.string().min(1),
  classId: z.string().min(1),
});

const patchSchema = z.object({
  posX: z.number().optional(),
  posY: z.number().optional(),
  posZ: z.number().optional(),
  lastRegionId: z.string().nullable().optional(),
  appearanceTag: z.string().nullable().optional(),

  // blobs (partial updates allowed)
  attributes: z.record(z.any()).optional(),
  inventory: z.record(z.any()).optional(),
  equipment: z.record(z.any()).optional(),
  spellbook: z.record(z.any()).optional(),
  abilities: z.record(z.any()).optional(),
  progression: z.record(z.any()).optional(),
});

const grantXpSchema = z.object({
  deltaXp: z.number(),
});

const learnSpellSchema = z.object({
  spellId: z.string().min(1),
  rank: z.number().int().min(1).optional(),
});

const equipSchema = z.object({
  slot: z.string().min(1),
  item: z.any(), // keep loose for now (we’ll harden later)
});

function getBearerToken(req: Request): string | null {
  const header = req.headers["authorization"] || req.headers["Authorization"];
  if (!header) return null;
  const [scheme, value] = (header as string).split(" ");
  if (!value) return null;
  if (scheme.toLowerCase() !== "bearer") return null;
  return value;
}

async function requireUser(req: Request): Promise<{ userId: string } | null> {
  const token = getBearerToken(req);
  if (!token) return null;

  const payload = await auth.verifyToken(token);
  if (!payload) return null;

  return { userId: payload.sub };
}

// GET /api/characters  – list characters for current user
router.get("/", async (req, res) => {
  try {
    const u = await requireUser(req);
    if (!u) return res.status(401).json({ error: "unauthorized" });

    const list: CharacterSummary[] =
      await characters.listCharactersForUser(u.userId);

    res.json({ ok: true, characters: list });
  } catch (err) {
    log.error("Error listing characters", { err });
    res.status(500).json({ error: "internal_error" });
  }
});

// POST /api/characters  – create a new character
router.post("/", async (req, res) => {
  try {
    const u = await requireUser(req);
    if (!u) return res.status(401).json({ error: "unauthorized" });

    const parsed = createCharacterSchema.safeParse(req.body);
    if (!parsed.success) {
      log.warn("Invalid createCharacter body", { body: req.body, issues: parsed.error.issues });
      return res.status(400).json({ error: "name, classId required" });
    }

    const { shardId, name, classId } = parsed.data;

    const resolvedShardId = shardId ?? "prime_shard";

    const created: CharacterState = await characters.createCharacter({
      userId: u.userId,
      shardId: resolvedShardId,
      name,
      classId,
    });

    res.json({ ok: true, character: created });
  } catch (err) {
    log.error("Error creating character", { err, body: req.body });
    res.status(500).json({ error: "internal_error" });
  }
});

// GET /api/characters/:id – fetch full state (must own character)
router.get("/:id", async (req, res) => {
  try {
    const u = await requireUser(req);
    if (!u) return res.status(401).json({ error: "unauthorized" });

    const id = String(req.params.id);
    const state = await characters.loadCharacterForUser(u.userId, id);
    if (!state) return res.status(404).json({ error: "not_found" });

    res.json({ ok: true, character: state });
  } catch (err) {
    log.error("Error fetching character", { err });
    res.status(500).json({ error: "internal_error" });
  }
});

// PATCH /api/characters/:id – partial update (safe scaffolding)
router.patch("/:id", async (req, res) => {
  try {
    const u = await requireUser(req);
    if (!u) return res.status(401).json({ error: "unauthorized" });

    const id = String(req.params.id);
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_patch", issues: parsed.error.issues });
    }

    const updated = await characters.patchCharacter(u.userId, id, parsed.data as any);
    if (!updated) return res.status(404).json({ error: "not_found" });

    res.json({ ok: true, character: updated });
  } catch (err) {
    log.error("Error patching character", { err });
    res.status(500).json({ error: "internal_error" });
  }
});

// POST /api/characters/:id/xp – grant xp (server-authoritative)
router.post("/:id/xp", async (req, res) => {
  try {
    const u = await requireUser(req);
    if (!u) return res.status(401).json({ error: "unauthorized" });

    const id = String(req.params.id);
    const parsed = grantXpSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "deltaXp required" });

    const updated = await characters.grantXp(u.userId, id, parsed.data.deltaXp);
    if (!updated) return res.status(404).json({ error: "not_found" });

    res.json({ ok: true, character: updated });
  } catch (err) {
    log.error("Error granting xp", { err });
    res.status(500).json({ error: "internal_error" });
  }
});

// POST /api/characters/:id/learn-spell
router.post("/:id/learn-spell", async (req, res) => {
  try {
    const u = await requireUser(req);
    if (!u) return res.status(401).json({ error: "unauthorized" });

    const id = String(req.params.id);
    const parsed = learnSpellSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "spellId required" });

    const updated = await characters.learnSpell(u.userId, id, parsed.data.spellId, parsed.data.rank ?? 1);
    if (!updated) return res.status(404).json({ error: "not_found" });

    res.json({ ok: true, character: updated });
  } catch (err) {
    log.error("Error learning spell", { err });
    res.status(500).json({ error: "internal_error" });
  }
});

// POST /api/characters/:id/equip
router.post("/:id/equip", async (req, res) => {
  try {
    const u = await requireUser(req);
    if (!u) return res.status(401).json({ error: "unauthorized" });

    const id = String(req.params.id);
    const parsed = equipSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "slot + item required" });

    const updated = await characters.equipItem(u.userId, id, parsed.data.slot, parsed.data.item);
    if (!updated) return res.status(404).json({ error: "not_found" });

    res.json({ ok: true, character: updated });
  } catch (err) {
    log.error("Error equipping item", { err });
    res.status(500).json({ error: "internal_error" });
  }
});

export default router;
