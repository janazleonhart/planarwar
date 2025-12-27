// worldcore/characters/PostgresCharacterService.ts

import { db } from "../db/Database";
import { Logger } from "../utils/logger";

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

export type CharacterPatch = Partial<CharacterState>;

export class PostgresCharacterService {
  private log = Logger.scope("CHAR_DB");

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
    return rowToCharacterState(result.rows[0]);
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
    return rowToCharacterState(r.rows[0]);
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
}
