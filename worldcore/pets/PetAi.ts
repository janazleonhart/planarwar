// worldcore/pets/PetAi.ts
//
// Pet Engine v1.3: role-aware tick-driven stance behavior (AI-lite).
// - Uses the existing combat pipeline (performNpcAttack) so threat/loot rules remain consistent.
// - Cooldown state is stored on the pet entity (avoids EntityManager churn).

import type { MudContext } from "../mud/MudContext";
import type { CharacterState } from "../characters/CharacterTypes";
import type { Entity } from "../shared/Entity";
import { performNpcAttack, type NpcAttackOptions } from "../mud/actions/MudCombatActions";
import {
  applyStatusEffect,
  applyStatusEffectToEntity,
  getActiveStatusEffectsForEntity,
} from "../combat/StatusEffects";

function envInt(name: string, fallback: number): number {
  const raw = String((process.env as any)?.[name] ?? "").trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function envNumber(name: string, fallback: number): number {
  const raw = String((process.env as any)?.[name] ?? "").trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = String((process.env as any)?.[name] ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "y" || raw === "on") return true;
  if (raw === "0" || raw === "false" || raw === "no" || raw === "n" || raw === "off") return false;
  return fallback;
}

type PetRole = "pet_tank" | "pet_dps" | "pet_heal" | "pet_utility";

function resolvePetRole(pet: Entity): PetRole {
  const roleRaw = String((pet as any).petRole ?? (pet as any).petClass ?? "").toLowerCase();
  const tags = Array.isArray((pet as any).petTags)
    ? (pet as any).petTags.map((t: any) => String(t).toLowerCase())
    : [];

  if (roleRaw.includes("tank") || tags.includes("pet_tank") || tags.includes("tank")) return "pet_tank";
  if (
    roleRaw.includes("heal") ||
    tags.includes("pet_heal") ||
    tags.includes("heal") ||
    tags.includes("healer")
  )
    return "pet_heal";
  if (roleRaw.includes("utility") || tags.includes("pet_utility") || tags.includes("utility")) return "pet_utility";
  return "pet_dps";
}

function hasEntityEffect(entity: Entity, id: string, nowMs: number): boolean {
  const list = getActiveStatusEffectsForEntity(entity, nowMs);
  return list.some((e) => e.id === id);
}

export type PetAttackPerformer = (
  ctx: MudContext,
  ownerChar: CharacterState,
  pet: Entity,
  target: Entity,
  opts?: NpcAttackOptions
) => Promise<string>;

function isReady(pet: Entity, key: string, nowMs: number): boolean {
  const nextAt = Number((pet as any)[key] ?? 0);
  return !Number.isFinite(nextAt) || nowMs >= nextAt;
}

function setCd(pet: Entity, key: string, nowMs: number, cdMs: number): void {
  (pet as any)[key] = nowMs + Math.max(0, Math.trunc(cdMs));
}

function getOwnerHpPct(ownerEnt: Entity): number {
  const cur = Number((ownerEnt as any).hp ?? 0);
  const max = Math.max(1, Number((ownerEnt as any).maxHp ?? 1));
  return cur / max;
}

function applyMend(ownerEnt: Entity, amount: number): number {
  const cur = Number((ownerEnt as any).hp ?? 0);
  const max = Math.max(1, Number((ownerEnt as any).maxHp ?? 1));
  const next = Math.min(max, cur + Math.max(0, Math.trunc(amount)));
  const applied = Math.max(0, next - cur);
  if (applied > 0) (ownerEnt as any).hp = next;
  return applied;
}

function resolveTargetForKits(ctx: MudContext, ownerEnt: Entity, pet: Entity): Entity | undefined {
  const em: any = (ctx as any)?.entities;
  if (!em || typeof em.getEntitiesInRoom !== "function") return undefined;
  const roomId = String(ownerEnt.roomId ?? "");
  if (!roomId) return undefined;
  const engagedId = String((ownerEnt as any).engagedTargetId ?? "").trim() || String((pet as any).engagedTargetId ?? "").trim();
  if (!engagedId) return undefined;
  const ents: any[] = em.getEntitiesInRoom(roomId) ?? [];
  const target = ents.find((e: any) => String(e?.id ?? "") === engagedId) as Entity | undefined;
  if (!target) return undefined;
  if ((target as any).alive === false || (target as any).hp <= 0) return undefined;
  return target;
}

async function maybePerformKitAction(
  ctx: MudContext,
  ownerChar: CharacterState,
  ownerEnt: Entity,
  pet: Entity,
  role: PetRole,
  nowMs: number,
): Promise<string | undefined> {
  // Heal / utility kits can run without an engaged target.
  const ownerPct = getOwnerHpPct(ownerEnt);

  // ── HEALER KITS ──────────────────────────────────────────────────────────
  if (role === "pet_heal") {
    // Mend when low.
    const mendThresh = Math.max(0, Math.min(1, envNumber("PW_PET_KIT_MEND_THRESHOLD_PCT", 0.6)));
    const mendCd = envInt("PW_PET_KIT_MEND_CD_MS", 1400);
    if (ownerPct <= mendThresh && isReady(pet, "_pwPetKitMendNextAt", nowMs)) {
      const max = Math.max(1, Number((ownerEnt as any).maxHp ?? 1));
      const mendAmt = Math.max(1, Math.round(max * envNumber("PW_PET_KIT_MEND_AMOUNT_PCT", 0.14)));
      const applied = applyMend(ownerEnt, mendAmt);
      setCd(pet, "_pwPetKitMendNextAt", nowMs, mendCd);
      if (applied > 0) return `[pet] Your pet mends your wounds (+${applied} HP).`;
    }

    // Regen HOT when moderately injured.
    const regenThresh = Math.max(0, Math.min(1, envNumber("PW_PET_KIT_REGEN_THRESHOLD_PCT", 0.85)));
    const regenCd = envInt("PW_PET_KIT_REGEN_CD_MS", 2200);
    if (ownerPct <= regenThresh && isReady(pet, "_pwPetKitRegenNextAt", nowMs)) {
      applyStatusEffect(ownerChar, {
        id: "pet_regen",
        sourceKind: "ability",
        sourceId: "pet_regen",
        name: "Regen",
        durationMs: envInt("PW_PET_KIT_REGEN_DURATION_MS", 6000),
        modifiers: {},
        hot: {
          tickIntervalMs: envInt("PW_PET_KIT_REGEN_TICK_MS", 1000),
          perTickHeal: envInt("PW_PET_KIT_REGEN_PER_TICK", 3),
        },
      }, nowMs);
      setCd(pet, "_pwPetKitRegenNextAt", nowMs, regenCd);
      return `[pet] Your pet whispers a soothing rhythm (Regen).`;
    }
  }

  // ── UTILITY KITS ─────────────────────────────────────────────────────────
  if (role === "pet_utility") {
    // Emergency mend (lower threshold, smaller amount).
    const mendThresh = Math.max(0, Math.min(1, envNumber("PW_PET_KIT_UTIL_MEND_THRESHOLD_PCT", 0.35)));
    const mendCd = envInt("PW_PET_KIT_MEND_CD_MS", 1200);
    if (ownerPct <= mendThresh && isReady(pet, "_pwPetKitMendNextAt", nowMs)) {
      const max = Math.max(1, Number((ownerEnt as any).maxHp ?? 1));
      const mendAmt = Math.max(1, Math.round(max * envNumber("PW_PET_KIT_UTIL_MEND_AMOUNT_PCT", 0.08)));
      const applied = applyMend(ownerEnt, mendAmt);
      setCd(pet, "_pwPetKitMendNextAt", nowMs, mendCd);
      if (applied > 0) return `[pet] Your pet patches you up (+${applied} HP).`;
    }

    const target = resolveTargetForKits(ctx, ownerEnt, pet);
    if (target && isReady(pet, "_pwPetKitDisruptNextAt", nowMs)) {
      const cd = envInt("PW_PET_KIT_DISRUPT_CD_MS", 2200);
      if (!hasEntityEffect(target, "pet_disrupt", nowMs)) {
        applyStatusEffectToEntity(target, {
          id: "pet_disrupt",
          sourceKind: "ability",
          sourceId: "pet_disrupt",
          name: "Disrupt",
          durationMs: envInt("PW_PET_KIT_DISRUPT_DURATION_MS", 4000),
          modifiers: {
            damageTakenPct: envNumber("PW_PET_KIT_DISRUPT_DAMAGE_TAKEN_PCT", 0.10),
          },
        }, nowMs);
      }
      setCd(pet, "_pwPetKitDisruptNextAt", nowMs, cd);
      return `[pet] Your pet disrupts the foe (Disrupt).`;
    }
  }

  // Offensive kits require a target.
  const target = resolveTargetForKits(ctx, ownerEnt, pet);
  if (!target) return undefined;

  // ── DPS KITS ─────────────────────────────────────────────────────────────
  if (role === "pet_dps") {
    if (isReady(pet, "_pwPetKitRendNextAt", nowMs)) {
      const cd = envInt("PW_PET_KIT_REND_CD_MS", 2500);
      if (!hasEntityEffect(target, "pet_rend", nowMs)) {
        applyStatusEffectToEntity(target, {
          id: "pet_rend",
          sourceKind: "ability",
          sourceId: "pet_rend",
          name: "Rend",
          durationMs: envInt("PW_PET_KIT_REND_DURATION_MS", 6000),
          modifiers: {},
          dot: {
            tickIntervalMs: envInt("PW_PET_KIT_REND_TICK_MS", 1000),
            perTickDamage: envInt("PW_PET_KIT_REND_PER_TICK", 2),
            damageSchool: "physical",
          },
        }, nowMs);
      }
      setCd(pet, "_pwPetKitRendNextAt", nowMs, cd);
      return `[pet] Your pet rends the target (Rend).`;
    }
  }

  // ── TANK KITS ────────────────────────────────────────────────────────────
  if (role === "pet_tank") {
    // Taunt (optional hook) is cheap and can fire before stonehide.
    if (isReady(pet, "_pwPetKitTauntNextAt", nowMs)) {
      const cd = envInt("PW_PET_KIT_TAUNT_CD_MS", 3500);
      const npcs: any = (ctx as any)?.npcs;
      if (npcs && typeof npcs.taunt === "function") {
        try {
          npcs.taunt(String(target.id), String(pet.id));
        } catch {
          // ignore
        }
      }
      setCd(pet, "_pwPetKitTauntNextAt", nowMs, cd);
      // do not return: we can also stonehide this tick if ready
    }

    if (isReady(pet, "_pwPetKitStonehideNextAt", nowMs)) {
      const cd = envInt("PW_PET_KIT_STONEHIDE_CD_MS", 4000);
      if (!hasEntityEffect(pet, "pet_stonehide", nowMs)) {
        applyStatusEffectToEntity(pet, {
          id: "pet_stonehide",
          sourceKind: "ability",
          sourceId: "pet_stonehide",
          name: "Stonehide",
          durationMs: envInt("PW_PET_KIT_STONEHIDE_DURATION_MS", 4000),
          modifiers: {
            damageTakenPct: envNumber("PW_PET_KIT_STONEHIDE_DAMAGE_TAKEN_PCT", -0.15),
          },
        }, nowMs);
      }
      setCd(pet, "_pwPetKitStonehideNextAt", nowMs, cd);
      return `[pet] Your pet hardens its hide (Stonehide).`;
    }
  }

  return undefined;
}

export async function tickPetsForCharacter(
  ctx: MudContext,
  ownerChar: CharacterState,
  nowMs: number,
  deps?: { perform?: PetAttackPerformer }
): Promise<string | undefined> {
  const enabled = envBool("PW_PET_AI_ENABLED", true);
  if (!enabled) return undefined;

  const em: any = (ctx as any)?.entities;
  const session: any = (ctx as any)?.session;
  if (!em || typeof em.getEntityByOwner !== "function" || typeof em.getPetByOwnerEntityId !== "function") return undefined;

  const sid = String(session?.id ?? session?.sessionId ?? "").trim();
  if (!sid) return undefined;

  const ownerEnt = em.getEntityByOwner(sid) as Entity | undefined;
  if (!ownerEnt) return undefined;

  const pet = em.getPetByOwnerEntityId(ownerEnt.id) as Entity | undefined;
  if (!pet) return undefined;
  if ((pet as any).alive === false || (pet as any).hp <= 0) return undefined;

  const mode = String((pet as any).petMode ?? "defensive").toLowerCase();
  if (mode === "passive") return undefined;

  const role = resolvePetRole(pet);

  // Role kits v1.4
  // NOTE: heal/utility pets still attack (owners will use them offensively),
  // but they will spend ticks performing kit actions when conditions warrant.
  // Kits generally should NOT prevent swinging; otherwise DPS kits would starve auto-attacks
  // and older contract tests (and player feel) regress.
  // If a kit fires while there is no valid combat target, we still return the kit line.
  const kitLine = await maybePerformKitAction(ctx, ownerChar, ownerEnt, pet, role, nowMs);

  // Healer pets are allowed to attack, but if they performed a heal kit action this tick
  // (mend/regen), they should not also swing. This matches existing contract semantics.
  const suppressSwing = role === "pet_heal" && !!kitLine;

  // Follow snap: v1.2 uses the same semantics as the command hook.
  const follow = (pet as any).followOwner === true;
  if (follow && String(pet.roomId) !== String(ownerEnt.roomId)) {
    (pet as any).roomId = String(ownerEnt.roomId);
  }

  // Target selection:
  // - defensive: owner engaged target only
  // - aggressive: owner engaged target, else pet engaged target if set
  const ownerEngagedId = String((ownerEnt as any).engagedTargetId ?? "").trim();
  const petEngagedId = String((pet as any).engagedTargetId ?? "").trim();
  const engagedId = ownerEngagedId || (mode === "aggressive" ? petEngagedId : "");
  if (!engagedId || suppressSwing) return kitLine ?? undefined;

  if (String(pet.roomId) !== String(ownerEnt.roomId)) return kitLine ?? undefined;

  const roomId = String(ownerEnt.roomId ?? "");
  const ents: any[] = em.getEntitiesInRoom?.(roomId) ?? [];
  const target = ents.find((e: any) => String(e?.id ?? "") === engagedId) as Entity | undefined;
  if (!target) return kitLine ?? undefined;
  if ((target as any).alive === false || (target as any).hp <= 0) return kitLine ?? undefined;

  // Cooldown throttle stored on the pet entity (role-tuned)
  const cdMs = Math.max(0, envInt(role === "pet_tank" ? "PW_PET_TANK_AI_COOLDOWN_MS" : role === "pet_dps" ? "PW_PET_DPS_AI_COOLDOWN_MS" : "PW_PET_UTILITY_AI_COOLDOWN_MS", envInt("PW_PET_AI_COOLDOWN_MS", role === "pet_tank" ? 950 : role === "pet_dps" ? 1050 : 1150)));
  const nextAt = Number((pet as any)._pwPetAiNextAt ?? 0);
  if (Number.isFinite(nextAt) && nowMs < nextAt) {
    // Cooldown prevented a swing; still surface the kit line if one fired.
    return kitLine ?? undefined;
  }
  (pet as any)._pwPetAiNextAt = nowMs + cdMs;

  const dmgMult = Math.max(0, envNumber(role === "pet_tank" ? "PW_PET_TANK_DAMAGE_MULT" : role === "pet_dps" ? "PW_PET_DPS_DAMAGE_MULT" : "PW_PET_UTILITY_DAMAGE_MULT", envNumber("PW_PET_DAMAGE_MULT", role === "pet_tank" ? 0.65 : role === "pet_dps" ? 0.9 : 0.55)));
  const opts: NpcAttackOptions = { damageMultiplier: dmgMult };

  const performer = deps?.perform ?? (performNpcAttack as any as PetAttackPerformer);
  const line = await performer(ctx, ownerChar, pet, target, opts);
  if (!line || !String(line).trim()) return kitLine ?? undefined;

  // Standardize prefix: tick output should be display-safe.
  const cleanedAttack = String(line).replace(/^\[(world|combat)\]\s*/i, "").trim();
  const attackOut = cleanedAttack ? `[pet] ${cleanedAttack}` : undefined;

  if (!kitLine) return attackOut;
  if (!attackOut) return kitLine;

  // Merge: keep a single [pet] prefix.
  const kitText = String(kitLine).replace(/^\[pet\]\s*/i, "").trim();
  const atkText = String(attackOut).replace(/^\[pet\]\s*/i, "").trim();
  return `[pet] ${kitText} ${atkText}`.trim();
}
