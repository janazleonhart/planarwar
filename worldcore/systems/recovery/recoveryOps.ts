// worldcore/systems/recovery/recoveryOps.ts

import { isDeadEntity, resurrectEntity } from "../../combat/entityCombat";

export type RecoveryContext = {
  session: { id: string };
  entities?: { getEntityByOwner(sessionId: string): any | null };
  // injected shutdown hooks (so we don’t import training dummy internals everywhere)
  stopAutoAttack?: (ctx: any) => string;
  stopTrainingDummyAi?: (sessionId: string) => void;
};

// v1 behavior: “restore to full” == resurrectEntity()
// (later we can split heal vs resurrect without touching commands)
export function restoreEntityToFull(ent: any): void {
  resurrectEntity(ent);
}

export function respawnInPlace(ctx: RecoveryContext): string {
  if (!ctx.entities) return "The world has no body for you right now.";

  const self = ctx.entities.getEntityByOwner(ctx.session.id);
  if (!self) return "You have no physical form here.";

  if (!isDeadEntity(self)) return "You are not dead.";

  restoreEntityToFull(self);

  ctx.stopAutoAttack?.(ctx);
  ctx.stopTrainingDummyAi?.(ctx.session.id);

  return "You pull yourself back together and feel fully restored.";
}

export function restOrSleep(ctx: RecoveryContext): string {
  if (!ctx.entities) return "The world has no body for you right now.";

  // Always disengage training dummy stuff when resting.
  ctx.stopAutoAttack?.(ctx);
  ctx.stopTrainingDummyAi?.(ctx.session.id);

  const self = ctx.entities.getEntityByOwner(ctx.session.id);
  if (!self) return "You have no physical form here.";

  const hp = (self as any).hp ?? 0;
  const maxHp = (self as any).maxHp ?? 0;

  // Dead → rez + full heal
  if (isDeadEntity(self)) {
    restoreEntityToFull(self);
    ctx.stopAutoAttack?.(ctx);
    ctx.stopTrainingDummyAi?.(ctx.session.id);
    return "You pull yourself back together and feel fully restored.";
  }

  // Hurt → full restore
  if (maxHp > 0 && hp < maxHp) {
    restoreEntityToFull(self);
    ctx.stopAutoAttack?.(ctx);
    ctx.stopTrainingDummyAi?.(ctx.session.id);
    return "You rest for a moment and feel fully restored.";
  }

  if (maxHp > 0 && hp >= maxHp) {
    return "You are already at full health.";
  }

  // If hp/maxHp missing, still do the “v1 restore” behavior.
  restoreEntityToFull(self);
  return "You rest for a moment and feel fully restored.";
}
