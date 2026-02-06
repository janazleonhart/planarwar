// worldcore/pets/PetAi.ts
//
// Pet Engine v1.2: tick-driven stance behavior (AI-lite).
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

  // Follow snap: v1.2 uses the same semantics as the command hook.
  const follow = (pet as any).followOwner === true;
  if (follow && String(pet.roomId) !== String(ownerEnt.roomId)) {
    (pet as any).roomId = String(ownerEnt.roomId);
  }

  // For v1.2, pets only act when owner has an engaged target.
  const engagedId = String((ownerEnt as any).engagedTargetId ?? "").trim();
  if (!engagedId) return undefined;

  if (String(pet.roomId) !== String(ownerEnt.roomId)) return undefined;

  const roomId = String(ownerEnt.roomId ?? "");
  const ents: any[] = em.getEntitiesInRoom?.(roomId) ?? [];
  const target = ents.find((e: any) => String(e?.id ?? "") === engagedId) as Entity | undefined;
  if (!target) return undefined;
  if ((target as any).alive === false || (target as any).hp <= 0) return undefined;

  // Cooldown throttle stored on the pet entity
  const cdMs = Math.max(0, envInt("PW_PET_AI_COOLDOWN_MS", 1200));
  const nextAt = Number((pet as any)._pwPetAiNextAt ?? 0);
  if (Number.isFinite(nextAt) && nowMs < nextAt) return undefined;
  (pet as any)._pwPetAiNextAt = nowMs + cdMs;

  const dmgMult = Math.max(0, envNumber("PW_PET_DAMAGE_MULT", 0.8));
  const opts: NpcAttackOptions = { damageMultiplier: dmgMult };

  const performer = deps?.perform ?? (performNpcAttack as any as PetAttackPerformer);
  const line = await performer(ctx, ownerChar, pet, target, opts);
  if (!line || !String(line).trim()) return undefined;

  // Standardize prefix: tick output should be display-safe.
  const cleaned = String(line).replace(/^\[(world|combat)\]\s*/i, "").trim();
  return cleaned ? `[pet] ${cleaned}` : undefined;
}
