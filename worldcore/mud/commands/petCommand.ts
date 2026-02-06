// worldcore/mud/commands/petCommand.ts
//
// Pet Engine v1.x:
// - Command-driven pet control
// - Stored stance/follow + gear state on character progression flags
//
// Pet Gear v1:
// - pet gear is real items moved from owner inventory
// - persists in progression.flags.pet.gear
// - later: will apply stats to pet entity on spawn

import type { MudContext } from "../MudContext";
import type { CharacterState } from "../../characters/CharacterTypes";
import type { MudCommandInput } from "./types";
import type { Entity } from "../../shared/Entity";
import { performNpcAttack } from "../actions/MudCombatActions";
import { applyProfileToPetVitals } from "../../pets/PetProfiles";
import { persistCharacterSnapshot } from "../../characters/characterPersist";
import {
  petEquipFirstMatchingFromBags,
  petUnequipToBags,
  formatPetGear,
} from "../../items/petEquipmentOps";

function ensurePetFlags(char: any): any {
  if (!char.progression) char.progression = {};
  if (!char.progression.flags) char.progression.flags = {};
  if (!char.progression.flags.pet) char.progression.flags.pet = {};
  return char.progression.flags.pet;
}

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
  return (
    ents.find((e: any) => String(e?.id ?? "").toLowerCase() === needle) ??
    ents.find((e: any) => String(e?.name ?? "").toLowerCase() === needle) ??
    ents.find((e: any) => String(e?.model ?? "").toLowerCase() === needle)
  );
}

async function bestEffortPersist(ctx: MudContext, char: CharacterState): Promise<void> {
  try {
    await persistCharacterSnapshot(ctx as any, char as any);
  } catch {
    // never block the command on persistence
  }
}

export async function handlePetCommand(
  ctx: MudContext,
  char: CharacterState,
  input: MudCommandInput
): Promise<string | null> {
  const args = Array.isArray((input as any)?.args) ? (input as any).args : [];
  const sub = String(args[0] ?? "").toLowerCase();

  const self = getSelfPlayerEntity(ctx);
  if (!self) return "[pet] You do not have an active body in the world.";

  const em: any = (ctx as any)?.entities;
  const roomId = String((self as any).roomId ?? "");

  if (!sub || sub === "help") {
    return [
      "[pet] Commands:",
      "  pet summon [protoId] [class]  - dev summon (spell-driven summoning is primary).",
      "  pet dismiss                   - dismiss your pet (persists).",
      "  pet follow | stay             - toggle follow behavior (persists).",
      "  pet passive|defensive|aggressive - set mode (persists).",
      "  pet attack [target]           - pet attacks target (defaults to your engaged target).",
      "  pet gear                      - show pet equipment.",
      "  pet equip <slot>              - equips first matching item from your bags onto pet.",
      "  pet unequip <slot>            - unequips pet item back to your bags/mail.",
    ].join("\n");
  }

  const petFlags = ensurePetFlags(char as any);

  // -----------------------
  // Pet gear commands
  // -----------------------
  if (sub === "gear") {
    return formatPetGear(char as any);
  }

  if (sub === "equip") {
    const slot = String(args[1] ?? "");
    const msg = await petEquipFirstMatchingFromBags(ctx as any, char as any, slot);
    await bestEffortPersist(ctx, char);
    return `[pet] ${msg}`;
  }

  if (sub === "unequip") {
    const slot = String(args[1] ?? "");
    const msg = await petUnequipToBags(ctx as any, char as any, slot);
    await bestEffortPersist(ctx, char);
    return `[pet] ${msg}`;
  }

  // -----------------------
  // Existing commands
  // -----------------------
  if (sub === "summon") {
    const proto = String(args[1] ?? "pet_wolf").trim() || "pet_wolf";

    if (!em || typeof em.createPetEntity !== "function") return "[pet] Pet system is not available.";

    // enforce single pet
    const existing = getPetForOwner(ctx, self.id);
    if (existing) return `[pet] You already have a pet (${existing.name ?? existing.model ?? existing.id}).`;

    const pet = em.createPetEntity(roomId, proto, self.id);

    const petClass = String(args[2] ?? "").trim();
    if (petClass) (pet as any).petClass = petClass;

    // Seed tags for profile resolution
    (pet as any).petTags = Array.isArray((pet as any).petTags) ? (pet as any).petTags : [];
    if (petClass) (pet as any).petTags.push(petClass);

    applyProfileToPetVitals(pet as any);

    // persist intent
    petFlags.active = true;
    petFlags.protoId = proto;
    if (petClass) petFlags.petClass = petClass;
    petFlags.autoSummon = true;
    if (petFlags.mode == null) petFlags.mode = "defensive";
    if (petFlags.followOwner == null) petFlags.followOwner = true;

    await bestEffortPersist(ctx, char);

    return `[pet] You summon ${pet.name ?? proto}.`;
  }

  if (sub === "dismiss" || sub === "despawn") {
    if (!em || typeof em.removePetForOwnerEntityId !== "function") return "[pet] Pet system is not available.";

    const ok = em.removePetForOwnerEntityId(self.id);

    // persist state (do not delete gear)
    petFlags.active = false;

    await bestEffortPersist(ctx, char);

    return ok ? "[pet] Your pet vanishes." : "[pet] You have no pet.";
  }

  if (sub === "follow" || sub === "stay") {
    const pet = getPetForOwner(ctx, self.id);
    if (!pet) return "[pet] You have no pet.";

    const follow = sub === "follow";
    (pet as any).followOwner = follow;

    petFlags.followOwner = follow;
    await bestEffortPersist(ctx, char);

    return follow ? "[pet] Your pet will follow you." : "[pet] Your pet stays here.";
  }

  if (sub === "passive" || sub === "defensive" || sub === "aggressive") {
    const pet = getPetForOwner(ctx, self.id);
    if (!pet) return "[pet] You have no pet.";

    (pet as any).petMode = sub;

    petFlags.mode = sub;
    await bestEffortPersist(ctx, char);

    return `[pet] Pet mode set to ${sub}.`;
  }

  if (sub === "attack") {
    const pet = getPetForOwner(ctx, self.id);
    if (!pet) return "[pet] You have no pet.";

    let targetRaw = String(args[1] ?? "").trim();
    if (!targetRaw) targetRaw = String((self as any).engagedTargetId ?? "").trim();
    if (!targetRaw) return "[pet] No target. Engage something or specify a target.";

    const target = findTargetInRoomByNameOrId(ctx, roomId, targetRaw);
    if (!target) return "[pet] Target not found in this room.";

    (pet as any).engagedTargetId = String((target as any).id ?? "");
    (pet as any).roomId = roomId;

    return await performNpcAttack(ctx, char, pet as any, target as any);
  }

  return "[pet] Unknown subcommand. Try: pet help";
}
