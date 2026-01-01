// worldcore/world/TownBaselines.ts

import type { EntityManager } from "../core/EntityManager";
import type { Entity } from "../shared/Entity";
import type { DbSpawnPoint } from "./SpawnPointService";

function envBool(name: string, defaultValue = false): boolean {
  const v = String(process.env[name] ?? "").trim().toLowerCase();
  if (!v) return defaultValue;
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function envStr(name: string, defaultValue: string): string {
  const v = String(process.env[name] ?? "").trim();
  return v || defaultValue;
}

function norm(s: any): string {
  return String(s ?? "").trim().toLowerCase();
}

function hashString(s: string): number {
  // Simple FNV-1a 32-bit hash (good enough for deterministic offsets)
  let h = 0x811c9dc5;
  const str = String(s ?? "");
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export const TOWNLIKE_TYPES = [
  "outpost",
  "town",
  "hub",
  "village",
  "city",
  "settlement",
  "camp",
] as const;

export function isTownLikeType(t: string): boolean {
  const x = norm(t);
  return (TOWNLIKE_TYPES as unknown as string[]).includes(x);
}

function isMailboxLike(ent: Entity): boolean {
  const type = norm((ent as any)?.type);
  if (type === "mailbox") return true;

  const protoId =
    norm((ent as any)?.protoId) ||
    norm((ent as any)?.templateId) ||
    norm((ent as any)?.archetype) ||
    norm((ent as any)?.model);

  if (!protoId) return false;
  if (protoId === "mailbox" || protoId === "mailbox_basic") return true;
  if (protoId.startsWith("mailbox_")) return true;
  if (protoId.startsWith("service_mail")) return true;
  return false;
}

function dist2(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}

export type EnsureTownBaselineArgs = {
  shardId: string;
  regionId: string;
  roomId: string;
  townSpawn: DbSpawnPoint;
  dryRun?: boolean;
};

export type EnsureTownBaselineResult = {
  didAnything: boolean;
  mailboxSpawned: boolean;
  mailboxAlreadyPresent: boolean;
};

/**
 * Ensures baseline "service anchors" exist for town-like POIs.
 *
 * v1 ensures ONE mailbox exists per town-like spawn point.
 */
export class TownBaselines {
  private ensuredKeys = new Set<string>();

  public readonly enabled: boolean;
  private readonly mailboxModel: string;
  private readonly mailboxRadius: number;

  constructor(private entities: EntityManager) {
    // OFF by default to avoid surprising future-us.
    this.enabled = envBool("PW_TOWN_BASELINES", false) || envBool("WORLD_TOWN_BASELINES", false);

    // The underlying EntityManager factory is still "createNpcEntity".
    // We treat the result as a generic entity and re-tag it.
    this.mailboxModel = envStr("PW_MAILBOX_MODEL", "mailbox_basic");

    // How close to town center we consider a mailbox "the same" mailbox.
    // (If a player spawns multiple towns in the same room, this prevents duplicates.)
    const rRaw = Number(process.env.PW_MAILBOX_RADIUS ?? "");
    this.mailboxRadius = Number.isFinite(rRaw) && rRaw > 0 ? Math.trunc(rRaw) : 12;
  }

  ensureTownBaseline(args: EnsureTownBaselineArgs): EnsureTownBaselineResult {
    const { shardId, regionId, roomId, townSpawn, dryRun } = args;
    if (!this.enabled) {
      return { didAnything: false, mailboxSpawned: false, mailboxAlreadyPresent: false };
    }

    const type = norm(townSpawn.type);
    if (!isTownLikeType(type)) {
      return { didAnything: false, mailboxSpawned: false, mailboxAlreadyPresent: false };
    }

    const townKey = String(townSpawn.spawnId ?? townSpawn.id ?? `${townSpawn.x ?? 0},${townSpawn.z ?? 0}`);
    const key = `${shardId}:${regionId}:${townKey}`;
    if (this.ensuredKeys.has(key)) {
      return { didAnything: false, mailboxSpawned: false, mailboxAlreadyPresent: true };
    }

    const cx = townSpawn.x ?? 0;
    const cy = townSpawn.y ?? 0;
    const cz = townSpawn.z ?? 0;

    const inRoom = this.entities.getEntitiesInRoom(roomId) ?? [];

    // If a mailbox already exists near the town center, we're done.
    const r2 = this.mailboxRadius * this.mailboxRadius;
    const already = inRoom.some((e) => isMailboxLike(e) && dist2(e.x ?? 0, e.z ?? 0, cx, cz) <= r2);
    if (already) {
      this.ensuredKeys.add(key);
      return { didAnything: false, mailboxSpawned: false, mailboxAlreadyPresent: true };
    }

    if (dryRun) {
      // Mark ensured so repeated dry runs don't spam.
      this.ensuredKeys.add(key);
      return { didAnything: true, mailboxSpawned: false, mailboxAlreadyPresent: false };
    }

    // Deterministic small offset so mailbox isn't on the exact same tile as the POI.
    const h = hashString(key);
    const dx = ((h % 5) - 2) * 2; // -4,-2,0,2,4
    const dz = (((h >>> 8) % 5) - 2) * 2;

    const ent = this.entities.createNpcEntity(roomId, this.mailboxModel);
    ent.type = "mailbox";
    ent.name = "Mailbox";
    ent.x = cx + dx;
    ent.y = cy;
    ent.z = cz + dz;

    // Mark as protected service (ServiceProtection checks these flags).
    (ent as any).isServiceProvider = true;
    (ent as any).isProtectedService = true;
    (ent as any).immuneToDamage = true;
    (ent as any).noAttack = true;

    // Helpful tags for downstream systems / UI.
    (ent as any).tags = ["service_mail", "protected_service"];

    // Preserve model/proto id for debugging.
    (ent as any).protoId = this.mailboxModel;

    // Ensure it isn't misclassified as a player-owned entity.
    delete (ent as any).ownerSessionId;

    this.ensuredKeys.add(key);

    return { didAnything: true, mailboxSpawned: true, mailboxAlreadyPresent: false };
  }
}
