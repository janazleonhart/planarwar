// worldcore/mud/commands/player/recoveryCommand.ts

import type { MudContext } from "../../MudContext";
import type { RecoveryContext } from "../../../systems/recovery/recoveryOps"

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

// --- Respawn (unchanged, HP-only) ---
export async function handleRespawnCommand(ctx: MudContext): Promise<string> {
  const recoveryCtx: RecoveryContext = {
    session: { id: ctx.session.id },
    entities: ctx.entities,
    stopAutoAttack,
    stopTrainingDummyAi,
  };

  return respawnInPlace(recoveryCtx);
}

// --- Rest: HP via recoveryOps + resource regen (mana/fury) ---
export async function handleRestCommand(ctx: MudContext): Promise<string> {
  const recoveryCtx: RecoveryContext = {
    session: { id: ctx.session.id },
    entities: ctx.entities,
    stopAutoAttack,
    stopTrainingDummyAi,
  };

  // 1) HP / death handling
  const baseMsg = restOrSleep(recoveryCtx);

  // 2) Resource handling (needs character on the session)
  const char = ctx.session.character;
  if (!char) {
    // No character attached (shouldn’t happen in normal play)
    return baseMsg;
  }

  const primary = getPrimaryPowerResourceForClass(char.classId);
  const pool = getOrInitPowerResource(char, primary);

  const before = pool.current;
  const gain = Math.max(10, Math.floor(pool.max * 0.25)); // 25% chunk
  gainPowerResource(char, primary, gain);
  const after = pool.current;

  const label = primary === "fury" ? "fury" : "mana";

  if (after === before) {
    // Already full on resource
    return `${baseMsg} Your ${label} is already full (${after}/${pool.max}).`;
  }

  return `${baseMsg} You also recover ${label} (${before} → ${after}/${pool.max}).`;
}
