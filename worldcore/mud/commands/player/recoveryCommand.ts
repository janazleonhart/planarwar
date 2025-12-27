// worldcore/mud/commands/player/recoveryCommand.ts

import type { MudContext } from "../../MudContext";
import type { RecoveryContext } from "../../../systems/recovery/recoveryOps";
import {
  respawnInPlace,
  restOrSleep,
} from "../../../systems/recovery/recoveryOps";
import { stopAutoAttack } from "../combat/autoattack/trainingDummyAutoAttack";
import { stopTrainingDummyAi } from "../../MudTrainingDummy";
import {
  getPrimaryPowerResourceForClass,
  getOrInitPowerResource,
  gainPowerResource,
} from "../../../resources/PowerResources";

// Minimal structural type for the RespawnService we threaded in via ctx.
// We don't import the actual class here to avoid extra compile coupling.
type RespawnLike = {
  respawnCharacter: (
    session: any,
    char: any
  ) => Promise<{ character: any; spawn: any }>;
};

// --- Respawn: shard/world-aware (with fallback to old HP-only behavior) ---
export async function handleRespawnCommand(
  ctx: MudContext
): Promise<string> {
  const char = ctx.session.character;

  // No character attached? Fallback to old behavior (or just shrug).
  if (!char) {
    const recoveryCtx: RecoveryContext = {
      session: { id: ctx.session.id },
      entities: ctx.entities,
      stopAutoAttack,
      stopTrainingDummyAi,
    };
    return respawnInPlace(recoveryCtx);
  }

  // Try to get a RespawnService instance off the context (wired by server.ts / router).
  const respawns = (ctx as any).respawns as RespawnLike | undefined;

  // If we don't have respawns or entities yet, fall back to the old local-only respawn.
  if (!respawns || !ctx.entities) {
    const recoveryCtx: RecoveryContext = {
      session: { id: ctx.session.id },
      entities: ctx.entities,
      stopAutoAttack,
      stopTrainingDummyAi,
    };
    return respawnInPlace(recoveryCtx);
  }

  const ent = ctx.entities.getEntityByOwner(ctx.session.id);
  const hp =
    ent && typeof (ent as any).hp === "number"
      ? (ent as any).hp
      : undefined;
  const aliveFlag =
    ent && typeof (ent as any).alive === "boolean"
      ? (ent as any).alive
      : undefined;
  const isDead = !ent || hp === 0 || (hp as number) < 0 || aliveFlag === false;

  if (!isDead) {
    return "You are not dead enough to respawn.";
  }

  // v0: ask RespawnService to put you at a sensible spawn and stand you up.
  const { spawn } = await respawns.respawnCharacter(ctx.session, char);

  if (spawn && spawn.regionId) {
    // Later we can include pretty region/settlement names.
    return "You feel your spirit pulled back to safety. You awaken at a safe place in this region.";
  }

  // Fallback text if we had no spawn and just stood you up where you were.
  return "You pull yourself back together and return to the waking world.";
}

// --- Rest: HP via recoveryOps + resource regen (mana only, no fury) ---
export async function handleRestCommand(
  ctx: MudContext
): Promise<string> {
  // 🔒 Combat gate: block full rest while recently in combat.
  let inCombatRecently = false;

  if (ctx.entities) {
    try {
      const ent: any = ctx.entities.getEntityByOwner(ctx.session.id);
      if (ent) {
        const inCombatUntil: number = ent.inCombatUntil ?? 0;
        const now = Date.now();
        if (inCombatUntil > now) {
          inCombatRecently = true;
        }
      }
    } catch {
      // If this blows up, better to allow rest than crash the command.
    }
  }

  if (inCombatRecently) {
    return "[rest] You can’t rest while in combat! Wait a few seconds after the fighting dies down.";
  }

  const recoveryCtx: RecoveryContext = {
    session: { id: ctx.session.id },
    entities: ctx.entities,
    stopAutoAttack,
    stopTrainingDummyAi,
  };

  // 1) HP / death handling (existing recoveryOps behavior)
  const baseMsg = restOrSleep(recoveryCtx);

  // 2) Resource handling (needs character on the session)
  const char = ctx.session.character;
  if (!char) {
    // No character attached (shouldn’t happen in normal play)
    return baseMsg;
  }

  const primary = getPrimaryPowerResourceForClass(char.classId);

  // 🔕 Fury (and any non-mana primary) should NOT be restored by resting.
  if (primary !== "mana") {
    return baseMsg;
  }

  const pool = getOrInitPowerResource(char, primary);
  const before = pool.current;
  const gain = Math.max(10, Math.floor(pool.max * 0.25)); // 25% chunk
  gainPowerResource(char, primary, gain);
  const after = pool.current;

  if (after === before) {
    // Already full on mana
    return `${baseMsg} Your mana is already full (${after}/${pool.max}).`;
  }

  return `${baseMsg} You also recover mana (${before} → ${after}/${pool.max}).`;
}
