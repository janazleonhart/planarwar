// worldcore/characters/PostgresCharacterService.ts

import { db } from "../db/Database";
import { Logger } from "../utils/logger";
import { learnSpellInState } from "../spells/SpellLearning";
import { learnAbilityInState } from "../abilities/AbilityLearning";
import { getReferenceKitEntriesForClass } from "../spells/ReferenceKits";

import {
  CharacterRow,
  CharacterState,
  CharacterSummary,
  CreateCharacterInput,
  rowToCharacterState,
  toCharacterSummary,
  defaultAttributes,
  defaultInventory,
  defaultEquipment,
  defaultSpellbook,
  defaultAbilities,
  defaultProgression,
  Attributes,
} from "./CharacterTypes";

import { applyXp } from "./Leveling";
import { getPerLevelAttributesForClass } from "../classes/ClassDefinitions";

function normalizeClassKey(classId: string): string {
  const raw = (classId || "").toLowerCase().trim();

  // If class_id is something like "PW_CLASS_WARLORD" or "PW_CLASS_VIRTUOSO",
  // strip the prefix and use the tail.
  const m = raw.match(/pw_class_(.+)$/);
  if (m && m[1]) return m[1];

  return raw;
}

function safeNowMs(nowMs?: number): number {
  const n = Number(nowMs);
  return Number.isFinite(n) ? n : Date.now();
}

function ensureObj(v: any): Record<string, any> {
  return v && typeof v === "object" ? v : {};
}

function ensureKnownMap(obj: any, key: string): Record<string, any> {
  const base = ensureObj(obj);
  const cur = (base as any)[key];
  if (!cur || typeof cur !== "object") (base as any)[key] = {};
  return (base as any)[key];
}

export type CharacterPatch = Partial<CharacterState>;

export class PostgresCharacterService {
  private log = Logger.scope("CHAR_DB");

  /**
   * Apply System 5.4 reference-kit auto-grants (L1–10) directly into the persisted
   * character state so the UI can see them immediately.
   *
   * Why this exists:
   * - Spell auto-grants can be computed on the fly (ensureSpellbookAutogrants), but the
   *   UI reads `spellbook.known` directly.
   * - Ability auto-grants can be computed on the fly too, but the UI reads `abilities`
   *   directly (either as a flat map or `abilities.known`).
   *
   * This function is idempotent.
   */
  private applyReferenceKitAutograntsInPlace(state: CharacterState, nowMs?: number): boolean {
    const now = safeNowMs(nowMs);
    const cls = normalizeClassKey(state.classId);
    const lvl = Number.isFinite(Number(state.level)) && Number(state.level) > 0 ? Number(state.level) : 1;

    const entries = getReferenceKitEntriesForClass(cls as any);
    if (!entries.length) return false;

    let changed = false;

    // Ensure base containers exist
    state.spellbook = ensureObj(state.spellbook) as any;
    const spellKnown = ensureKnownMap(state.spellbook as any, "known");

    state.abilities = ensureObj(state.abilities) as any;
    const abilKnown = ensureKnownMap(state.abilities as any, "known");
    const abilLearned = ensureKnownMap(state.abilities as any, "learned");

    for (const e of entries as any[]) {
      if (!e || e.isEnabled === false || e.autoGrant !== true) continue;
      const minLevel = Math.max(1, Number(e.minLevel ?? 1) || 1);
      if (lvl < minLevel) continue;

      if (e.kind === "spell") {
        const spellId = String(e.spellId ?? "").trim();
        if (!spellId) continue;
        if (!spellKnown[spellId]) {
          spellKnown[spellId] = { rank: 1, learnedAt: now };
          changed = true;
        }
        continue;
      }

      if (e.kind === "ability") {
        const abilityId = String(e.abilityId ?? "").trim();
        if (!abilityId) continue;

        // UI reads abilities (flat map or abilities.known). Runtime code prefers abilities.learned.
        if (!abilKnown[abilityId]) {
          abilKnown[abilityId] = { rank: 1, learnedAt: now };
          changed = true;
        }
        if (!abilLearned[abilityId]) {
          abilLearned[abilityId] = { rank: 1, learnedAt: now };
          changed = true;
        }
        // Preserve older UI behavior that treated `abilities` as a flat id->true map.
        if (!(state.abilities as any)[abilityId]) {
          (state.abilities as any)[abilityId] = true;
          changed = true;
        }
        continue;
      }
    }

    return changed;
  }

  async listCharactersForUser(userId: string): Promise<CharacterSummary[]> {
    const result = await db.query(
      `
      SELECT *
      FROM characters
      WHERE user_id = $1
      ORDER BY created_at ASC
    `,
      [userId]
    );

    const states = result.rows.map(rowToCharacterState);
    return states.map(toCharacterSummary);
  }

  async loadCharacter(id: string): Promise<CharacterState | null> {
    const result = await db.query(
      `SELECT * FROM characters WHERE id = $1`,
      [id]
    );

    if (result.rowCount === 0) return null;
    const state = rowToCharacterState(result.rows[0]);

    // Backfill reference-kit grants for older characters (idempotent).
    if (this.applyReferenceKitAutograntsInPlace(state)) {
      await this.saveCharacter(state);
    }

    return state;
  }

  async loadCharacterForUser(
    userId: string,
    charId: string
  ): Promise<CharacterState | null> {
    const r = await db.query(
      `SELECT * FROM characters WHERE id = $1 AND user_id = $2`,
      [charId, userId]
    );

    if (r.rowCount === 0) return null;
    const state = rowToCharacterState(r.rows[0]);

    // Backfill reference-kit grants for older characters (idempotent).
    if (this.applyReferenceKitAutograntsInPlace(state)) {
      await this.saveCharacter(state);
    }

    return state;
  }

  async createCharacter(input: CreateCharacterInput): Promise<CharacterState> {
    const { userId, shardId, name, classId } = input;

    const result = await db.query(
      `
      INSERT INTO characters (
        user_id,
        shard_id,
        name,
        class_id,
        level,
        xp,
        pos_x,
        pos_y,
        pos_z,
        last_region_id,
        appearance_tag,
        attributes,
        inventory,
        equipment,
        spellbook,
        abilities,
        progression,
        state_version
      )
      VALUES (
        $1, $2, $3, $4,
        $5, $6,
        $7, $8, $9,
        $10, $11,
        $12, $13, $14, $15, $16, $17, $18
      )
      RETURNING *
    `,
      [
        userId,
        shardId,
        name,
        classId,
        1, // level
        0, // xp
        0,
        0,
        0, // pos
        null,
        null, // region / appearance
        defaultAttributes(),
        defaultInventory(),
        defaultEquipment(),
        defaultSpellbook(),
        defaultAbilities(),
        defaultProgression(),
        1,
      ]
    );

    const state = rowToCharacterState(result.rows[0]);

    // Ensure new characters actually *have* their L1 reference-kit actions in state.
    if (this.applyReferenceKitAutograntsInPlace(state)) {
      await this.saveCharacter(state);
    }

    this.log.info("Created character", {
      id: state.id,
      userId: state.userId,
      shardId: state.shardId,
      classId: state.classId,
    });

    return state;
  }

  async saveCharacter(state: CharacterState): Promise<void> {
    await db.query(
      `
      UPDATE characters
      SET
        shard_id = $2,
        name = $3,
        class_id = $4,
        level = $5,
        xp = $6,
        pos_x = $7,
        pos_y = $8,
        pos_z = $9,
        last_region_id = $10,
        appearance_tag = $11,
        attributes = $12,
        inventory = $13,
        equipment = $14,
        spellbook = $15,
        abilities = $16,
        progression = $17,
        state_version = $18,
        updated_at = NOW()
      WHERE id = $1
    `,
      [
        state.id,
        state.shardId,
        state.name,
        state.classId,
        state.level,
        state.xp,
        state.posX,
        state.posY,
        state.posZ,
        state.lastRegionId,
        state.appearanceTag,
        state.attributes,
        state.inventory,
        state.equipment,
        state.spellbook,
        state.abilities,
        state.progression,
        state.stateVersion ?? 1,
      ]
    );
  }

  async patchCharacter(
    userId: string,
    charId: string,
    patch: CharacterPatch
  ): Promise<CharacterState | null> {
    const existing = await this.loadCharacterForUser(userId, charId);
    if (!existing) return null;

    const merged: CharacterState = {
      ...existing,
      ...patch,

      // deep-merge JSON blobs if patch provided
      attributes: patch.attributes
        ? { ...existing.attributes, ...patch.attributes }
        : existing.attributes,

      inventory: patch.inventory
        ? ({ ...existing.inventory, ...patch.inventory } as any)
        : existing.inventory,

      equipment: patch.equipment
        ? { ...existing.equipment, ...patch.equipment }
        : existing.equipment,

      spellbook: patch.spellbook
        ? ({ ...existing.spellbook, ...patch.spellbook } as any)
        : existing.spellbook,

      abilities: patch.abilities
        ? { ...existing.abilities, ...patch.abilities }
        : existing.abilities,

      progression: patch.progression
        ? ({ ...existing.progression, ...patch.progression } as any)
        : existing.progression,
    };

    await this.saveCharacter(merged);
    return await this.loadCharacter(charId);
  }

  async grantXp(
    userId: string,
    charId: string,
    deltaXp: number
  ): Promise<CharacterState | null> {
    const existing = await this.loadCharacterForUser(userId, charId);
    if (!existing) return null;

    const beforeLevel = existing.level;
    const beforeAttrs = existing.attributes;

    const r = applyXp(existing.level, existing.xp, deltaXp);
    const levelsGained = r.newLevel - beforeLevel;

    let newAttributes = beforeAttrs;

    if (levelsGained > 0) {
      newAttributes = this.applyAttributeGains(
        existing.classId,
        beforeAttrs,
        levelsGained
      );
    }

    const updated: CharacterState = {
      ...existing,
      level: r.newLevel,
      xp: r.newXp,
      attributes: newAttributes,
    };

    // Reference-kit L1–10 grants should appear as you level.
    this.applyReferenceKitAutograntsInPlace(updated);

    await this.saveCharacter(updated);
    return await this.loadCharacter(charId);
  }

  /**
   * Simple per-level attribute growth.
   * Later we can move this to a proper class progression table / config.
   */
  private applyAttributeGains(
    classId: string,
    attrs: Attributes,
    levelsGained: number
  ): Attributes {
    const perLevel = this.getPerLevelGains(classId);
    const total = levelsGained;

    return {
      ...attrs,
      str: attrs.str + perLevel.str * total,
      agi: attrs.agi + perLevel.agi * total,
      int: attrs.int + perLevel.int * total,
      sta: attrs.sta + perLevel.sta * total,
      wis: attrs.wis + perLevel.wis * total,
      cha: attrs.cha + perLevel.cha * total,
    };
  }

  /**
   * Very rough class-based growth.
   * This is just a v1 stub and can be replaced with data-driven tables later.
   */
  private getPerLevelGains(classId: string): Attributes {
    return getPerLevelAttributesForClass(normalizeClassKey(classId));
  }

  async learnSpell(
    userId: string,
    charId: string,
    spellId: string,
    rank = 1
  ): Promise<CharacterState | null> {
    const existing = await this.loadCharacterForUser(userId, charId);
    if (!existing) return null;

    const now = Date.now();

    const next: CharacterState = {
      ...existing,
      spellbook: {
        ...existing.spellbook,
        known: {
          ...(existing.spellbook.known ?? {}),
          [spellId]: {
            rank,
            learnedAt: now,
          },
        },
      },
    };

    await this.saveCharacter(next);
    return await this.loadCharacter(charId);
  }


  /**
   * Learn a spell with unlock-policy enforcement.
   *
   * - In DB/test mode: requires an enabled spell_unlocks rule for the spell (classId/any + minLevel).
   * - In code-fallback mode: allows any catalog-known spell (dev-friendly / backwards compatible).
   *
   * Returns a small result envelope for API friendliness.
   */
  async learnSpellWithRules(
    userId: string,
    characterId: string,
    spellId: string,
    rank = 1,
    opts?: { viaTrainer?: boolean; bypassGrant?: boolean },
  ): Promise<
    | { ok: true; character: CharacterState }
    | { ok: false; error: string; requiredRule?: any }
  > {
    const existing = await this.loadCharacterForUser(userId, characterId);
    if (!existing) return { ok: false, error: "not_found" };

    const res = learnSpellInState(existing as any, spellId, rank, undefined, opts as any);
    if (res.ok === false) {
      return { ok: false, error: res.error, requiredRule: (res as any).requiredRule };
    }

    await this.saveCharacter(res.next as any);
    const reloaded = await this.loadCharacterForUser(userId, characterId);
    return { ok: true, character: reloaded as any };
  }

  /**
   * Learn an ability with unlock-policy enforcement.
   *
   * Abilities are persisted under CharacterState.abilities.learned[abilityId].
   */
  async learnAbilityWithRules(
    userId: string,
    characterId: string,
    abilityId: string,
    rank = 1,
    opts?: { viaTrainer?: boolean; bypassGrant?: boolean },
  ): Promise<
    | { ok: true; character: CharacterState }
    | { ok: false; error: string; requiredRule?: any }
  > {
    const existing = await this.loadCharacterForUser(userId, characterId);
    if (!existing) return { ok: false, error: "not_found" };

    const res = learnAbilityInState(existing as any, abilityId, rank, undefined, opts as any);
    if (res.ok === false) {
      return { ok: false, error: res.error, requiredRule: (res as any).requiredRule };
    }

    await this.saveCharacter(res.next as any);
    const reloaded = await this.loadCharacterForUser(userId, characterId);
    return { ok: true, character: reloaded as any };
  }

  async equipItem(
    userId: string,
    charId: string,
    slot: string,
    item: any
  ): Promise<CharacterState | null> {
    const existing = await this.loadCharacterForUser(userId, charId);
    if (!existing) return null;

    const next: CharacterState = {
      ...existing,
      equipment: {
        ...existing.equipment,
        [slot]: item,
      },
    };

    await this.saveCharacter(next);
    return await this.loadCharacter(charId);
  }

async renameCharacterForUser(
  userId: string,
  charId: string,
  newName: string
): Promise<CharacterState | null> {
  const name = String(newName ?? "").trim();
  if (!name) throw new Error("invalid_name");
  if (name.length > 24) throw new Error("invalid_name");

  // patchCharacter already enforces ownership via loadCharacterForUser()
  return await this.patchCharacter(userId, charId, { name } as any);
}

async deleteCharacterForUser(userId: string, charId: string): Promise<boolean> {
  const existing = await this.loadCharacterForUser(userId, charId);
  if (!existing) return false;

  const result = await db.query(`DELETE FROM characters WHERE id = $1 AND user_id = $2`, [charId, userId]);
  const ok = Boolean(result && (result.rowCount ?? 0) > 0);

  if (ok) {
    this.log.info("Deleted character", { id: charId, userId });
  }

  return ok;
}

}