// worldcore/mud/commands/petCommand.ts
//
// Pet Engine v1:
// - Command-driven pet control (no AI yet)
// - One pet per owner (v1)

import type { MudContext } from "../MudContext";
import type { CharacterState } from "../../characters/CharacterTypes";
import type { MudCommandInput } from "./types";
import type { Entity } from "../../shared/Entity";
import { performNpcAttack } from "../actions/MudCombatActions";
import { applyProfileToPetVitals, getProfileDamageMult } from "../../pets/PetProfiles";

function getSelfPlayerEntity(ctx: MudContext): Entity | undefined {
  const em: any = (ctx as any)?.entities;
  const session: any = (ctx as any)?.session;
  const sid = String(session?.id ?? session?.sessionId ?? "").trim();
  if (!em || typeof em.getEntityByOwner !== "function" || !sid) return undefined;
  return em.getEntityByOwner(sid);
}

function getPetForOwner(ctx: MudContext, ownerEntityId: string): Entity | undefined {
  const em: any = (ctx as any)?.entities;
  if (!em || typeof em.getPetByOwnerEntityId !== "function") return undefined;
  return em.getPetByOwnerEntityId(ownerEntityId);
}

function getEntitiesInRoom(ctx: MudContext, roomId: string): Entity[] {
  const em: any = (ctx as any)?.entities;
  const list = em?.getEntitiesInRoom?.(roomId);
  return Array.isArray(list) ? (list as any) : [];
}

function findTargetInRoomByNameOrId(ctx: MudContext, roomId: string, raw: string): Entity | undefined {
  const needle = String(raw ?? "").trim().toLowerCase();
  if (!needle) return undefined;
  const ents = getEntitiesInRoom(ctx, roomId);
  return ents.find((e: any) => String(e?.id ?? "").toLowerCase() === needle) ??
    ents.find((e: any) => String(e?.name ?? "").toLowerCase() === needle) ??
    ents.find((e: any) => String(e?.model ?? "").toLowerCase() === needle);
}

export async function handlePetCommand(
  ctx: MudContext,
  char: CharacterState,
  input: MudCommandInput
): Promise<string> {
  const args = Array.isArray((input as any)?.args) ? (input as any).args : [];
  const sub = String(args[0] ?? "").toLowerCase();

  const self = getSelfPlayerEntity(ctx);
  if (!self) return "[pet] You do not have an active body in the world.";

  const em: any = (ctx as any)?.entities;
  const roomId = String((self as any).roomId ?? "");

  if (!sub || sub === "help") {
    return [
      "[pet] Commands:",
      "  pet summon [protoId] [class] - summon a pet (dev v1.3; real summoning will be spell-driven).",
      "  pet dismiss               - dismiss your pet.",
      "  pet follow | stay         - toggle follow behavior.",
      "  pet passive|defensive|aggressive - set mode (v1 stored, AI later).",
      "  pet attack [target]       - pet attacks target (defaults to your engaged target).",
    ].join("\n");
  }

  if (sub === "summon") {
    const proto = String(args[1] ?? "pet_wolf").trim() || "pet_wolf";
    const existing = getPetForOwner(ctx, self.id);
    if (existing) return `[pet] You already have a pet (${existing.name ?? existing.model ?? existing.id}).`;
    if (!em || typeof em.createPetEntity !== "function") return "[pet] Pet system is not available.";

    const pet = em.createPetEntity(roomId, proto, self.id);

    const petClass = String(args[2] ?? "").trim();
    if (petClass) (pet as any).petClass = petClass;

    // Owner-only visibility (v1)
    (pet as any).ownerSessionId = String((ctx as any)?.session?.id ?? "");

    // Seed tags for profile resolution (v1.3)
    (pet as any).petTags = Array.isArray((pet as any).petTags) ? (pet as any).petTags : [];
    if (petClass) (pet as any).petTags.push(petClass);

    try {
      applyProfileToPetVitals(pet as any);
    } catch {
      // ignore
    }

    // Persist desired pet state for reconnect restore.
    try {
      const prog: any = (char as any).progression ?? ((char as any).progression = {});
      const flags: any = prog.flags ?? (prog.flags = {});
      flags.pet = {
        active: true,
        protoId: proto,
        petClass: petClass || undefined,
        mode: String((pet as any).petMode ?? "defensive"),
        followOwner: (pet as any).followOwner !== false,
        autoSummon: true,
      };

      (ctx as any)?.session && ((ctx as any).session.character = char);
      await (ctx as any)?.characters?.saveCharacter?.(char);
    } catch {
      // best-effort
    }

    return `[pet] You summon ${pet.name ?? proto}.`;
  }

  if (sub === "dismiss" || sub === "despawn") {
    if (!em || typeof em.removePetForOwnerEntityId !== "function") return "[pet] Pet system is not available.";
    const ok = em.removePetForOwnerEntityId(self.id);

    // Persist: mark pet inactive.
    try {
      const prog: any = (char as any).progression ?? ((char as any).progression = {});
      const flags: any = prog.flags ?? (prog.flags = {});
      const prev: any = flags.pet && typeof flags.pet === "object" ? flags.pet : {};
      flags.pet = { ...prev, active: false };
      (ctx as any)?.session && ((ctx as any).session.character = char);
      await (ctx as any)?.characters?.saveCharacter?.(char);
    } catch {
      // best-effort
    }

    return ok ? "[pet] Your pet vanishes." : "[pet] You have no pet.";
  }

  if (sub === "follow" || sub === "stay") {
    const pet = getPetForOwner(ctx, self.id);
    if (!pet) return "[pet] You have no pet.";
    (pet as any).followOwner = sub === "follow";

    try {
      const prog: any = (char as any).progression ?? ((char as any).progression = {});
      const flags: any = prog.flags ?? (prog.flags = {});
      const prev: any = flags.pet && typeof flags.pet === "object" ? flags.pet : {};
      flags.pet = { ...prev, followOwner: (pet as any).followOwner === true };
      (ctx as any)?.session && ((ctx as any).session.character = char);
      await (ctx as any)?.characters?.saveCharacter?.(char);
    } catch {
      // best-effort
    }

    return sub === "follow" ? "[pet] Your pet will follow you." : "[pet] Your pet stays here.";
  }

  if (sub === "passive" || sub === "defensive" || sub === "aggressive") {
    const pet = getPetForOwner(ctx, self.id);
    if (!pet) return "[pet] You have no pet.";
    (pet as any).petMode = sub;

    try {
      const prog: any = (char as any).progression ?? ((char as any).progression = {});
      const flags: any = prog.flags ?? (prog.flags = {});
      const prev: any = flags.pet && typeof flags.pet === "object" ? flags.pet : {};
      flags.pet = { ...prev, mode: sub };
      (ctx as any)?.session && ((ctx as any).session.character = char);
      await (ctx as any)?.characters?.saveCharacter?.(char);
    } catch {
      // best-effort
    }

    return `[pet] Pet mode set to ${sub}.`;
  }

  if (sub === "attack") {
    const pet = getPetForOwner(ctx, self.id);
    if (!pet) return "[pet] You have no pet.";

    // Target: explicit arg or owner's engaged target.
    let targetRaw = String(args[1] ?? "").trim();
    if (!targetRaw) {
      targetRaw = String((self as any).engagedTargetId ?? "").trim();
    }
    if (!targetRaw) return "[pet] No target. Engage something or specify a target.";

    const target = findTargetInRoomByNameOrId(ctx, roomId, targetRaw);
    if (!target) return "[pet] Target not found in this room.";

    // v1: execute a single melee attack using the shared pipeline.
    (pet as any).engagedTargetId = String((target as any).id ?? "");
    pet.roomId = roomId; // safety

    return await performNpcAttack(ctx, char, pet as any, target as any);
  }

  return "[pet] Unknown subcommand. Try: pet help";
}
