// worldcore/pets/PetAi.ts
//
// Pet Engine v1.3: role-aware tick-driven stance behavior (AI-lite).
// - Uses the existing combat pipeline (performNpcAttack) so threat/loot rules remain consistent.
// - Cooldown state is stored on the pet entity (avoids EntityManager churn).

import type { MudContext } from "../mud/MudContext";
import type { CharacterState } from "../characters/CharacterTypes";
import type { Entity } from "../shared/Entity";
import { performNpcAttack, type NpcAttackOptions } from "../mud/actions/MudCombatActions";

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

export type PetAttackPerformer = (
  ctx: MudContext,
  ownerChar: CharacterState,
  pet: Entity,
  target: Entity,
  opts?: NpcAttackOptions
) => Promise<string>;

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

  const roleRaw = String((pet as any).petRole ?? (pet as any).petClass ?? "").toLowerCase();
  const tags = Array.isArray((pet as any).petTags) ? (pet as any).petTags.map((t: any) => String(t).toLowerCase()) : [];
  const role = (roleRaw.includes("tank") || tags.includes("pet_tank") || tags.includes("tank")) ? "pet_tank"
    : (roleRaw.includes("heal") || tags.includes("pet_heal") || tags.includes("heal") || tags.includes("healer")) ? "pet_heal"
    : (roleRaw.includes("utility") || tags.includes("pet_utility") || tags.includes("utility")) ? "pet_utility"
    : "pet_dps";

  // Simple healer behavior: heal owner when injured (no auto-swing when stable).
  const healThreshold = Math.max(0, Math.min(1, envNumber("PW_PET_HEAL_THRESHOLD_PCT", role === "pet_utility" ? 0.35 : 0.7)));
  if ((role === "pet_heal" || role === "pet_utility") && ownerEnt.alive !== false) {
    const cur = Number((ownerEnt as any).hp ?? 0);
    const max = Math.max(1, Number((ownerEnt as any).maxHp ?? 1));
    const pct = cur / max;
    if (pct <= healThreshold) {
      const cdHealMs = Math.max(0, envInt("PW_PET_HEAL_AI_COOLDOWN_MS", role === "pet_utility" ? 1200 : 1400));
      const nextAt = Number((pet as any)._pwPetAiNextAt ?? 0);
      if (!Number.isFinite(nextAt) || nowMs >= nextAt) {
        const healPct = Math.max(0, envNumber("PW_PET_HEAL_AMOUNT_PCT", role === "pet_utility" ? 0.08 : 0.14));
        const healFlat = Math.max(0, envInt("PW_PET_HEAL_AMOUNT_FLAT", 0));
        let amt = Math.max(1, Math.round(max * healPct));
        if (healFlat > 0) amt = Math.max(amt, healFlat);
        const next = Math.min(max, cur + amt);
        const applied = Math.max(0, next - cur);
        if (applied > 0) {
          (ownerEnt as any).hp = next;
          (pet as any)._pwPetAiNextAt = nowMs + cdHealMs;
          return `[pet] Your pet tends your wounds (+${applied} HP).`;
        }
      }
    }
    if (role === "pet_heal") return undefined;
  }

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
  if (!engagedId) return undefined;

  if (String(pet.roomId) !== String(ownerEnt.roomId)) return undefined;

  const roomId = String(ownerEnt.roomId ?? "");
  const ents: any[] = em.getEntitiesInRoom?.(roomId) ?? [];
  const target = ents.find((e: any) => String(e?.id ?? "") === engagedId) as Entity | undefined;
  if (!target) return undefined;
  if ((target as any).alive === false || (target as any).hp <= 0) return undefined;

  // Cooldown throttle stored on the pet entity (role-tuned)
  const cdMs = Math.max(0, envInt(role === "pet_tank" ? "PW_PET_TANK_AI_COOLDOWN_MS" : role === "pet_dps" ? "PW_PET_DPS_AI_COOLDOWN_MS" : "PW_PET_UTILITY_AI_COOLDOWN_MS", envInt("PW_PET_AI_COOLDOWN_MS", role === "pet_tank" ? 950 : role === "pet_dps" ? 1050 : 1150)));
  const nextAt = Number((pet as any)._pwPetAiNextAt ?? 0);
  if (Number.isFinite(nextAt) && nowMs < nextAt) return undefined;
  (pet as any)._pwPetAiNextAt = nowMs + cdMs;

  const dmgMult = Math.max(0, envNumber(role === "pet_tank" ? "PW_PET_TANK_DAMAGE_MULT" : role === "pet_dps" ? "PW_PET_DPS_DAMAGE_MULT" : "PW_PET_UTILITY_DAMAGE_MULT", envNumber("PW_PET_DAMAGE_MULT", role === "pet_tank" ? 0.65 : role === "pet_dps" ? 0.9 : 0.55)));
  const opts: NpcAttackOptions = { damageMultiplier: dmgMult };

  const performer = deps?.perform ?? (performNpcAttack as any as PetAttackPerformer);
  const line = await performer(ctx, ownerChar, pet, target, opts);
  if (!line || !String(line).trim()) return undefined;

  // Standardize prefix: tick output should be display-safe.
  const cleaned = String(line).replace(/^\[(world|combat)\]\s*/i, "").trim();
  return cleaned ? `[pet] ${cleaned}` : undefined;
}
