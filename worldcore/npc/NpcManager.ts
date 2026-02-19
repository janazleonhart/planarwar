// worldcore/npc/NpcManager.ts

/**
 * Owns runtime NPC state and threat tables, bridges EntityManager ↔ AI brains,
 * and coordinates guard/pack help plus crime tagging. Driven by TickEngine and
 * constructed via WorldServices.
 */

import { EntityManager } from "../core/EntityManager";
import { SessionManager } from "../core/SessionManager";
import { Logger } from "../utils/logger";
import {
  getNpcAggroModeForRegionSync,
  getNpcPursuitProfileForRegionSync,
  isTownSanctuaryForRegionSync,
  allowSiegeBreachForRegionSync,
  isTownSanctuaryGuardSortieForRegionSync,
  isGuardRecaptureSweepForRegionSync,
  getTownSanctuaryGuardSortieRangeTilesForRegionSync,
  peekRegionFlagsCache,
  getRegionFlags,
} from "../world/RegionFlags";
import type { Entity } from "../shared/Entity";
import { WorldEventBus } from "../world/WorldEventBus";
import type { TownSiegeService } from "../world/TownSiegeService";

import {
  NpcRuntimeState,
  NpcPrototype,
  getNpcPrototype,
  DEFAULT_NPC_PROTOTYPES,
  GuardProfile,
  getGuardCallRadius,
} from "./NpcTypes";

import {
  PerceivedPlayer,
  NpcPerception,
} from "../ai/NpcBrainTypes";

import { LocalSimpleAggroBrain } from "../ai/LocalSimpleNpcBrain";

import {
  getLastAttackerFromThreat,
  getTopThreatTarget,
  selectThreatTarget,
  getThreatValue,
  applyTauntToThreat,
  addThreatValue,
  decayThreat,
  type NpcThreatState,
  updateThreatFromDamage,
} from "./NpcThreat";

import { recordNpcCrimeAgainst, isProtectedNpc } from "./NpcCrime";
import { isServiceProtectedNpcProto } from "../combat/ServiceProtection";
import { isValidCombatTarget } from "../combat/CombatTargeting";
import { clearAllStatusEffectsFromEntity, getActiveStatusEffectsForEntity, clearEntityStatusEffectsByTags, breakCrowdControlOnDamage, absorbIncomingDamageFromEntityStatusEffects } from "../combat/StatusEffects";
import { handleNpcDeath } from "../combat/NpcDeathPipeline";

import {
  markInCombat,
  applySimpleDamageToPlayer,
  computeNpcMeleeDamage,
} from "../combat/entityCombat";

import { getCombatRoleForClass } from "../classes/ClassDefinitions";
import type { CharacterState } from "../characters/CharacterTypes";

function envNumber(name: string, fallback: number): number {
  const raw = String((process.env as any)?.[name] ?? "").trim();
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function envBool(name: string, fallback: boolean): boolean {

  const raw = String((process.env as any)?.[name] ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") return true;
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false;
  return fallback;
}

function envString(name: string, fallback: string): string {
  const raw = String((process.env as any)?.[name] ?? "").trim();
  return raw ? raw : fallback;
}

type RoomXY = { shard: string; x: number; y: number };

function parseRoomXY(roomId: string): RoomXY | null {
  // Expected canonical form: "shardName:x,y" (e.g. "prime_shard:12,-4").
  const s = String(roomId ?? "");
  const idx = s.lastIndexOf(":");
  if (idx <= 0) return null;
  const shard = s.slice(0, idx);
  const rest = s.slice(idx + 1);
  const parts = rest.split(",");
  if (parts.length !== 2) return null;
  const x = Number(parts[0]);
  const y = Number(parts[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { shard, x, y };
}

function roomGridDistance(aRoomId: string, bRoomId: string): number {
  const a = parseRoomXY(aRoomId);
  const b = parseRoomXY(bRoomId);
  if (!a || !b) return Number.POSITIVE_INFINITY;
  if (a.shard !== b.shard) return Number.POSITIVE_INFINITY;
  // Chebyshev distance on the room grid: diagonal adjacency counts as 1.
  // This matches the way Train room pursuit/assist is intended to feel.
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

type TrainConfig = {
  enabled: boolean;
  step: number;
  softLeash: number;
  hardLeash: number;
  pursueTimeoutMs: number;
  // v0.1: room pursuit + assist snap
  roomsEnabled: boolean;
  maxRoomsFromSpawn: number;
  assistEnabled: boolean;
  assistSnapAllies: boolean;
  assistSnapMaxAllies: number;
  assistRange: number;
  returnMode: "snap" | "drift";
};

/**
 * Apply a region-level pursuit profile to TrainConfig.
 *
 * This is deliberately conservative:
 * - It NEVER forces Train on (if trainCfgBase.enabled is false, result stays off).
 * - It clamps values downward for "short" so semi-safe zones can't accidentally become train factories.
 */
export function applyTrainProfileForRegion(
  trainCfgBase: TrainConfig,
  profile: "default" | "short" | "train",
): TrainConfig {
  if (profile === "default" || profile === "train") return trainCfgBase;
  if (!trainCfgBase.enabled) return trainCfgBase;

  // "short" pursuit: keep things local and predictable.
  return {
    ...trainCfgBase,
    // clamp chase distance/time
    softLeash: Math.min(trainCfgBase.softLeash, 12),
    hardLeash: Math.min(trainCfgBase.hardLeash, 20),
    pursueTimeoutMs: Math.min(trainCfgBase.pursueTimeoutMs, 6_000),
    // if rooms are enabled globally, only allow 1 room from spawn in short zones
    maxRoomsFromSpawn: Math.min(trainCfgBase.maxRoomsFromSpawn, 1),
    // do not allow train assist snapping in semi-safe zones
    assistEnabled: false,
    assistSnapAllies: false,
  };
}

function readTrainConfig(): TrainConfig {
  return {
    enabled: envBool("PW_TRAIN_ENABLED", false),
    step: Math.max(0, envNumber("PW_TRAIN_STEP", 1.5)),
    softLeash: Math.max(0, envNumber("PW_TRAIN_SOFT_LEASH", 25)),
    hardLeash: Math.max(0, envNumber("PW_TRAIN_HARD_LEASH", 40)),
    pursueTimeoutMs: Math.max(0, Math.floor(envNumber("PW_TRAIN_PURSUE_TIMEOUT_MS", 20000))),
    // v0.1
    roomsEnabled: envBool("PW_TRAIN_ROOMS_ENABLED", false),
    maxRoomsFromSpawn: Math.max(0, Math.floor(envNumber("PW_TRAIN_MAX_ROOMS_FROM_SPAWN", 6))),
    assistEnabled: envBool("PW_TRAIN_ASSIST_ENABLED", false),
    assistSnapAllies: envBool("PW_TRAIN_ASSIST_SNAP_ALLIES", false),
    assistSnapMaxAllies: Math.max(0, Math.floor(envNumber("PW_TRAIN_ASSIST_SNAP_MAX_ALLIES", 6))),
    assistRange: Math.max(0, envNumber("PW_TRAIN_ASSIST_RANGE", 10)),
    returnMode: (envString("PW_TRAIN_RETURN_MODE", "snap").toLowerCase() === "drift" ? "drift" : "snap"),
  };
}


// Prevent taunt spam-lock; during this window, new taunts from OTHER entities are ignored.
const PW_TAUNT_IMMUNITY_MS = Math.max(0, Math.floor(envNumber("PW_TAUNT_IMMUNITY_MS", 0)));



// Assist threat sharing: when an NPC calls for pack help, seed allies with a share of the caller's current threat
// against the offender. This makes pack assist focus feel stable and reduces coin-flip target swaps.

const log = Logger.scope("NPC");

/**
 * Server-side NPC manager.
 *
 * - Owns runtime NPC state (hp, room, etc.)
 * - Bridges EntityManager ↔ AI brain ↔ sessions/chat.
 */
export class NpcManager {
  // Stable tick timestamp used to prevent double-move when Train chase is invoked from multiple gates in one updateAll().
  private _tickNow: number = 0;
  // Simulated monotonic time (ms). Initialized from Date.now() then advanced by deltaMs in updateAll().
  private _simNow: number = 0;
  private npcsByEntityId = new Map<string, NpcRuntimeState>();
  private npcsByRoom = new Map<string, Set<string>>();
  private npcThreat = new Map<string, NpcThreatState>();
  private guardHelpCalled = new Map<string, Set<string>>();
  private packHelpCalled = new Map<string, Set<string>>();
  private packHelpCalledAt = new Map<string, Map<string, number>>();
  // Per-caller throttling for repeated pack-assist calls against the same offender.
  // Key: callerNpcId -> (offenderEntityId -> lastCallAtTickMs)
  private packHelpCallAt = new Map<string, Map<string, number>>();
  // Global throttling: prevent multiple pack members from calling help against the same offender
  // within a short window (reduces cascade dogpiles).
  // Key: `${groupId}:${offenderEntityId}` -> lastCallAtTickMs
  private packHelpOffenderAt = new Map<string, number>();

  // Region flag prefetch throttle for DB-backed regions.flags (used by NPC AI).
  // Key: `${shardId}:${roomOrRegionId}` -> lastPrefetchAtMs
  private regionFlagsPrefetchAt = new Map<string, number>();

  private readonly brain = new LocalSimpleAggroBrain();

  // Optional services used for the canonical death pipeline (XP/loot/respawn).
  // Attached by WorldServices after construction.
  private deathServices?: {
    rooms?: any;
    characters?: any;
    items?: any;
    mail?: any;
  };

  // Optional event bus (used for world event hooks such as town siege pressure).
  private events?: WorldEventBus;

  // Optional town siege state (used for "siege mood" modifiers).
  private townSiege?: TownSiegeService;

  // Town sanctuary pressure tracker (in-memory, per server runtime).
  // Key: sanctuaryRoomId -> rolling window of pressure timestamps.
  private townSanctuaryPressure = new Map<
    string,
    { timestampsMs: number[]; lastEmitMs: number }
  >();


  constructor(
    private readonly entities: EntityManager,
    private readonly sessions?: SessionManager,
  ) {}

  /**
   * Attach optional services required for XP/loot/corpse/respawn handling.
   * This keeps NpcManager usable in lightweight tests while enabling the
   * canonical death pipeline in the full server.
   */
  attachDeathPipelineServices(svc: {
    rooms?: any;
    characters?: any;
    items?: any;
    mail?: any;
  }): void {
    this.deathServices = svc;
  }


  /**
   * Attach optional WorldEventBus for emitting world-level signals.
   * Kept optional so lightweight tests can construct NpcManager without wiring full WorldServices.
   */
  attachEventBus(events: WorldEventBus): void {
    this.events = events;
  }

  /**
   * Attach optional TownSiegeService for siege-aware behaviors.
   * Kept optional so lightweight tests can construct NpcManager without full WorldServices.
   */
  attachTownSiegeService(townSiege: TownSiegeService): void {
    this.townSiege = townSiege;
  }



  private isGuardProtectedRoom(proto?: NpcPrototype | null): boolean {
    const tags = proto?.tags ?? [];

    return (
      tags.includes("town") ||
      tags.includes("protected_town") ||
      tags.includes("guard") ||
      proto?.guardProfile !== undefined
    );
  }


  private readTownSanctuaryPressureConfig() {
    const windowMs = Math.max(
      1000,
      Number(process.env.PW_TOWN_SANCTUARY_PRESSURE_WINDOW_MS ?? 15000),
    );
    const threshold = Math.max(
      1,
      Number(process.env.PW_TOWN_SANCTUARY_PRESSURE_THRESHOLD ?? 12),
    );
    const cooldownMs = Math.max(
      0,
      Number(process.env.PW_TOWN_SANCTUARY_PRESSURE_COOLDOWN_MS ?? windowMs),
    );

    return { windowMs, threshold, cooldownMs };
  }

  private readTownSiegeGuardSortieBonusTiles(): number {
    const raw = String(process.env.PW_TOWN_SIEGE_GUARD_SORTIE_RANGE_BONUS_TILES ?? "1").trim();
    const n = Number(raw);
    if (!Number.isFinite(n)) return 1;
    return Math.max(0, Math.floor(n));
  }

  private readTownSiegeGuardMoraleProactive(): { enabled: boolean; recentAggroWindowMs: number } {
    const v = String(process.env.PW_TOWN_SIEGE_GUARD_MORALE_PROACTIVE ?? "0").trim().toLowerCase();
    const enabled = v === "1" || v === "true" || v === "yes" || v === "on";

    const raw = String(process.env.PW_TOWN_SIEGE_GUARD_MORALE_RECENT_AGGRO_WINDOW_MS ?? "10000").trim();
    const n = Number(raw);
    const recentAggroWindowMs = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 10_000;

    return { enabled, recentAggroWindowMs };
  }

  private recordTownSanctuaryPressure(sanctuaryRoomId: string, nowMs: number): void {
    const { windowMs, threshold, cooldownMs } = this.readTownSanctuaryPressureConfig();
    const cur =
      this.townSanctuaryPressure.get(sanctuaryRoomId) ??
      ({ timestampsMs: [], lastEmitMs: 0 } as { timestampsMs: number[]; lastEmitMs: number });

    // Purge old samples.
    const keepAfter = nowMs - windowMs;
    cur.timestampsMs = cur.timestampsMs.filter((t) => t >= keepAfter);
    cur.timestampsMs.push(nowMs);

    const count = cur.timestampsMs.length;
    const canEmit = nowMs - cur.lastEmitMs >= cooldownMs;

    if (count >= threshold && canEmit) {
      cur.lastEmitMs = nowMs;
      // Reset samples so we don't spam emit on every subsequent block.
      cur.timestampsMs = [];

      try {
        this.events?.emit("town.sanctuary.siege", {
          shardId: String(sanctuaryRoomId.split(":")[0] ?? ""),
          roomId: sanctuaryRoomId,
          pressureCount: count,
          windowMs,
        });
      } catch {
        // best-effort
      }
    }

    this.townSanctuaryPressure.set(sanctuaryRoomId, cur);
  }

  // -------------------------------------------------------------------------
  // Spawning / Despawning
  // -------------------------------------------------------------------------

  spawnNpc(
    proto: NpcPrototype,
    roomId: string,
    x: number,
    y: number,
    z: number,
    variantId?: string | null,
  ): NpcRuntimeState {
    const e = this.entities.createNpcEntity(
      roomId,
      proto.model ?? proto.name,
    );

    const tags = proto.tags ?? [];
    const isResource =
      tags.includes("resource") ||
      tags.some((t) => t.startsWith("resource_"));

    if (isResource) {
      e.type = "node";
    } else {
      e.type = "npc";
    }

    (e as any).protoId = proto.id;
    e.hp = proto.maxHp;
    e.maxHp = proto.maxHp;
    e.alive = true;
    e.name = proto.name;

    // Service-provider NPCs are invulnerable (banker/mailbox/auctioneer, etc.)
    if (isServiceProtectedNpcProto(proto)) {
      (e as any).invulnerable = true;
      (e as any).isServiceProvider = true;
    }

    this.entities.setPosition(e.id, x, y, z);

    // Preserve immutable spawn/home coords for respawn logic
    (e as any).spawnX = x;
    (e as any).spawnY = y;
    (e as any).spawnZ = z;

    // Mirror spawn coords onto runtime state as well (tests may rely on snapback even if entity spawn fields are missing later).
    // These are intentionally attached dynamically to avoid type-shape churn.

    const state: NpcRuntimeState = {
      entityId: e.id,
      protoId: proto.id,
      templateId: proto.id,
      variantId: variantId ?? null,
      roomId,
      spawnRoomId: roomId,
      hp: proto.maxHp,
      maxHp: proto.maxHp,
      alive: true,
      fleeing: false,
    };

    (state as any).spawnX = x;
    (state as any).spawnY = y;
    (state as any).spawnZ = z;


    this.npcsByEntityId.set(e.id, state);
    this.npcThreat.set(e.id, {});

    let set = this.npcsByRoom.get(roomId);
    if (!set) {
      set = new Set();
      this.npcsByRoom.set(roomId, set);
    }
    set.add(e.id);

    log.info("NPC spawned", { protoId: proto.id, entityId: e.id, roomId, x, y, z });

    return state;
  }

  spawnNpcById(
    protoId: string,
    roomId: string,
    x: number,
    y: number,
    z: number,
    variantId?: string | null,
  ): NpcRuntimeState | null {
    const templateId =
      variantId && variantId.trim().length > 0
        ? `${protoId}@${variantId.trim()}`
        : protoId;

    const proto =
      getNpcPrototype(templateId) ??
      getNpcPrototype(protoId) ??
      DEFAULT_NPC_PROTOTYPES[templateId] ??
      DEFAULT_NPC_PROTOTYPES[protoId];

    if (!proto) {
      log.warn("spawnNpcById: unknown proto", {
        protoId,
        variantId,
        templateId,
      });
      return null;
    }

    const state = this.spawnNpc(proto, roomId, x, y, z, variantId);

    // preserve identity vs template
    state.protoId = protoId;
    state.templateId = proto.id;
    state.variantId = variantId ?? null;

    return state;
  }

  getNpcStateByEntityId(entityId: string): NpcRuntimeState | undefined {
    return this.npcsByEntityId.get(entityId);
  }

  getEntity(entityId: string): Entity | undefined {
    return this.entities.get(entityId);
  }

  listNpcsInRoom(roomId: string): NpcRuntimeState[] {
    const set = this.npcsByRoom.get(roomId);
    if (!set) return [];

    const out: NpcRuntimeState[] = [];
    for (const entityId of set) {
      const st = this.npcsByEntityId.get(entityId);
      if (st) out.push(st);
    }
    return out;
  }

  despawnNpc(entityId: string): void {
    const st = this.npcsByEntityId.get(entityId);
    if (!st) return;

    // Defensive cleanup: despawn implies removal from the world; status effects must not linger.
    try {
      const e = this.entities.get(entityId) as any;
      if (e) clearAllStatusEffectsFromEntity(e);
    } catch {
      // ignore
    }

    this.npcsByEntityId.delete(entityId);
    this.npcThreat.delete(entityId);

    const set = this.npcsByRoom.get(st.roomId);
    if (set) {
      set.delete(entityId);
      if (set.size === 0) {
        this.npcsByRoom.delete(st.roomId);
      }
    }

    this.entities.removeEntity(entityId);

    log.info("NPC despawned", { entityId });
  }

  // -------------------------------------------------------------------------
  // Combat helpers
  // -------------------------------------------------------------------------

  applyDamage(
    entityId: string,
    amount: number,
    attacker?: { character?: CharacterState; entityId?: string; damageSchool?: any; tag?: string },
  ): number | null {
    const st = this.npcsByEntityId.get(entityId);
    if (!st) return null;

    const e = this.entities.get(entityId) as any;
    if (!e) return null;

    const proto =
      getNpcPrototype(st.templateId) ??
      getNpcPrototype(st.protoId) ??
      DEFAULT_NPC_PROTOTYPES[st.templateId] ??
      DEFAULT_NPC_PROTOTYPES[st.protoId];

    // Service-provider NPCs are immune to damage (banker/mailbox/auctioneer, etc.)
    if (isServiceProtectedNpcProto(proto) || (e as any).invulnerable === true) {
      (e as any).invulnerable = true;
      (e as any).isServiceProvider = true;
      return st.hp;
    }

    const wasAlive = st.alive;

    // Normalize/round incoming damage (deterministic).
    const rawIn = Number.isFinite(amount) ? amount : 0;
    let dmg = Math.max(0, Math.floor(rawIn));
    if (rawIn > 0 && dmg < 1) dmg = 1;

    // Absorb shields (NPC status effects live on the entity).
    // NOTE: absorbed damage should still count as a "hit" for CC break,
    // but it does not reduce HP.
    let absorbed = 0;
    if (dmg > 0) {
      try {
        const school: any = (attacker as any)?.damageSchool ?? "physical";
        const res = absorbIncomingDamageFromEntityStatusEffects(e as any, dmg, school, Date.now());
        absorbed = Math.max(0, Math.floor(Number(res.absorbed ?? 0)));
        dmg = Math.max(0, Math.floor(Number(res.remainingDamage ?? dmg)));
      } catch {
        // best-effort only
      }
    }

    const hitDamage = Math.max(0, dmg + absorbed);

    const newHp = Math.max(0, st.hp - dmg);
    st.hp = newHp;
    st.alive = newHp > 0;
    e.hp = newHp;
    e.alive = newHp > 0;

    // CC v0.3: any damage breaks "break-on-damage" mind-control style CC on NPCs.
    // Mez/Sleep/Incapacitate are intentionally fragile (EverQuest vibes).
    if (hitDamage > 0 && wasAlive && newHp > 0) {
      breakCrowdControlOnDamage({ entity: e as any, damage: hitDamage, now: Date.now() });
    }

    // Death implies all combat status effects should be cleared (DOTs, debuffs, etc.)
    // so corpses don't keep ticking or carry modifiers into any respawn path.
    if (wasAlive && newHp <= 0) {
      try {
        clearAllStatusEffectsFromEntity(e);
      } catch {
        // ignore
      }
    }

    // Best-effort attacker resolution: DOT ticks often only know attackerEntityId.
    let atkChar: CharacterState | undefined = attacker?.character;
    if (!atkChar && attacker?.entityId && this.sessions) {
      try {
        const aEnt: any = this.entities.get(attacker.entityId);
        const ownerSessionId = aEnt?.ownerSessionId;
        if (ownerSessionId) {
          const s: any = this.sessions.get(ownerSessionId);
          if (s?.character) atkChar = s.character as CharacterState;
        }
      } catch {
        // ignore
      }
    }

    if (atkChar && proto) {
      if (isProtectedNpc(proto)) {
        recordNpcCrimeAgainst(st, atkChar, {
          lethal: newHp <= 0,
          proto,
        });
      }

      if (proto.canCallHelp && proto.groupId && attacker?.entityId) {
        this.notifyPackAllies(attacker.entityId, st, proto, {
          snapAllies: false,
        });
      }
    }

    if (st.alive && st.maxHp > 0 && st.hp < st.maxHp) {
      // coward brains / flee will respond on next tick
      st.fleeing = st.fleeing ?? false;
    }

    return newHp;
  }

  /**
   * Apply DOT damage to an NPC and route fatal ticks through the canonical
   * death pipeline (XP/loot/corpse/respawn). This method is intentionally
   * safe to call from synchronous tick loops; any async reward work is
   * started best-effort and not awaited.
   */
  applyDotDamage(
    npcEntityId: string,
    amount: number,
    meta?: any,
    attackerEntityId?: string,
  ): number | null {
    const st = this.npcsByEntityId.get(npcEntityId);
    if (!st) return null;

    // HEAL: Tick loops may only carry DOT attribution meta (appliedByKind/appliedById)
    // and omit attackerEntityId. When that happens, resolve the attacker entity
    // best-effort so XP/loot/corpse credit routes correctly.
    if (!attackerEntityId && meta && this.sessions) {
      try {
        const kind = String(meta.appliedByKind ?? "");
        const id = String(meta.appliedById ?? "");

        let ownerSessionId: string | null = null;

        if (kind === "session" && id) {
          ownerSessionId = id;
        } else if (kind === "character" && id) {
          for (const s of this.sessions.values()) {
            const ch: any = (s as any).character;
            if (ch && String(ch.id) === id) {
              ownerSessionId = s.id;
              break;
            }
          }
        }

        if (ownerSessionId) {
          const selfEnt = this.entities.getEntityByOwner(ownerSessionId);
          if (selfEnt) attackerEntityId = selfEnt.id;
        }
      } catch {
        // ignore
      }
    }

    const wasAlive = st.alive;

    const beforeHp = st.hp;

    // Apply damage (shields/absorbs are applied inside applyDamage).
    const newHp = this.applyDamage(
      npcEntityId,
      amount,
      attackerEntityId
        ? { entityId: attackerEntityId, damageSchool: (meta as any)?.school ?? (meta as any)?.damageSchool ?? "pure" }
        : undefined,
    );

    // Best-effort threat attribution (prefer effective damage; hostile ticks still seed minimal threat).
    if (attackerEntityId) {
      try {
        const effective = typeof newHp === "number" ? Math.max(0, beforeHp - newHp) : 0;
        const threatAmt = effective > 0 ? effective : amount > 0 ? 1 : 0;
        if (threatAmt > 0) this.recordDamage(npcEntityId, attackerEntityId, threatAmt);
      } catch {
        // ignore
      }
    }

    // Non-fatal tick: nothing else to do.
    if (!wasAlive || newHp == null || newHp > 0) {
      this.maybeEmitDotCombatLog(npcEntityId, amount, meta, attackerEntityId, newHp);
      return newHp;
    }

    // Fatal tick: route through canonical death pipeline if services are attached.
    try {
      const npcEnt: any = this.entities.get(npcEntityId);
      const aEnt: any = attackerEntityId ? this.entities.get(attackerEntityId) : null;
      const ownerSessionId = aEnt?.ownerSessionId;
      const session: any = ownerSessionId && this.sessions ? this.sessions.get(ownerSessionId) : null;
      const char: any = session?.character ?? null;

      if (npcEnt && this.deathServices) {
        // Mark dead here (NpcManager is allowlisted for alive mutation).
        try {
          npcEnt.hp = 0;
          npcEnt.alive = false;
        } catch {
          // ignore
        }

        void handleNpcDeath(
          {
            npcs: this,
            entities: this.entities,
            rooms: this.deathServices.rooms,
            characters: this.deathServices.characters,
            items: this.deathServices.items,
            mail: this.deathServices.mail,
          },
          npcEnt,
          { session, char, selfEntity: aEnt },
          { silentText: process.env.PW_DOT_COMBAT_LOG !== "1" },
        ).then((res) => {
          // Optional: emit a DOT kill line to the attacker.
          if (process.env.PW_DOT_COMBAT_LOG === "1") {
            this.emitDotKillLine(npcEntityId, amount, meta, attackerEntityId, res?.text ?? "");
          }
        });
      }
    } catch {
      // ignore
    }

    // Also emit per-tick log if enabled.
    this.maybeEmitDotCombatLog(npcEntityId, amount, meta, attackerEntityId, newHp);
    return newHp;
  }

  private maybeEmitDotCombatLog(
    npcEntityId: string,
    amount: number,
    meta: any,
    attackerEntityId: string | undefined,
    newHp: number | null,
  ): void {
    if (process.env.PW_DOT_COMBAT_LOG !== "1") return;
    if (!attackerEntityId || !this.sessions) return;

    try {
      const npc: any = this.entities.get(npcEntityId);
      const aEnt: any = this.entities.get(attackerEntityId);
      const ownerSessionId = aEnt?.ownerSessionId;
      if (!ownerSessionId) return;
      const session: any = this.sessions.get(ownerSessionId);
      if (!session) return;

      const dotName = String(meta?.name ?? meta?.id ?? meta?.effectId ?? "dot");
      const hpStr = typeof newHp === "number" ? `${newHp}/${npc?.maxHp ?? "?"}` : "?";
      const line = `[dot:${dotName}] ${npc?.name ?? "Target"} takes ${Math.floor(amount)} damage. (${hpStr} HP)`;

      this.sessions.send(session, "mud_result", { text: line });
    } catch {
      // ignore
    }
  }

  private emitDotKillLine(
    npcEntityId: string,
    amount: number,
    meta: any,
    attackerEntityId: string | undefined,
    rewardTextSuffix: string,
  ): void {
    if (!attackerEntityId || !this.sessions) return;
    try {
      const npc: any = this.entities.get(npcEntityId);
      const aEnt: any = this.entities.get(attackerEntityId);
      const ownerSessionId = aEnt?.ownerSessionId;
      if (!ownerSessionId) return;
      const session: any = this.sessions.get(ownerSessionId);
      if (!session) return;

      const dotName = String(meta?.name ?? meta?.id ?? meta?.effectId ?? "dot");
      let line = `[dot:${dotName}] You slay ${npc?.name ?? "your target"}!`;
      if (rewardTextSuffix) line += rewardTextSuffix;

      this.sessions.send(session, "mud_result", { text: line });
    } catch {
      // ignore
    }
  }

  recordDamage(targetEntityId: string, attackerEntityId: string, threatAmount?: number): void {
    const st = this.npcsByEntityId.get(targetEntityId);
    if (!st) return;

    const e = this.entities.get(targetEntityId) as any;
    const proto =
      getNpcPrototype(st.templateId) ??
      getNpcPrototype(st.protoId) ??
      DEFAULT_NPC_PROTOTYPES[st.templateId] ??
      DEFAULT_NPC_PROTOTYPES[st.protoId];

    // Service-provider NPCs are not aggroable/tauntable.
    if (isServiceProtectedNpcProto(proto) || (e as any)?.invulnerable === true) {
      (e as any).invulnerable = true;
      (e as any).isServiceProvider = true;
      return;
    }

    const now = this._tickNow || Date.now();
    const amt = typeof threatAmount === "number" ? threatAmount : 1;

    // Threat transfer: if the attacker is under a "threat redirect" effect,
    // credit some (or all) of their generated threat to another entity.
    let toId: string | undefined;
    let pct = 0;
    try {
      const attackerEnt: any = this.entities.get(attackerEntityId);
      if (attackerEnt) {
        const active = getActiveStatusEffectsForEntity(attackerEnt as any, now);
        for (const eff of active) {
          const mod: any = (eff as any)?.modifiers ?? {};
          const candidate = String(mod?.threatTransferToEntityId ?? "").trim();
          if (!candidate) continue;
          const rawPct = typeof mod?.threatTransferPct === "number" ? mod.threatTransferPct : 1;
          const clamped = Math.max(0, Math.min(1, rawPct));
          // Deterministic: choose the highest transfer pct; tie-break by id.
          if (clamped > pct || (clamped === pct && candidate < String(toId ?? "\uffff"))) {
            toId = candidate;
            pct = clamped;
          }
        }
      }
    } catch {
      // ignore
    }

    let threat = this.npcThreat.get(targetEntityId);
    if (toId && pct > 0 && toId !== attackerEntityId && this.entities.get(toId)) {
      const transferred = amt * pct;
      const remaining = amt - transferred;

      // Credit the receiver WITHOUT changing lastAttacker (preserve damage dealer).
      threat = addThreatValue(threat, toId, transferred, now, {
        setLastAttacker: true,
        lastAttackerEntityId: attackerEntityId,
      });

      if (remaining > 0) {
        threat = addThreatValue(threat, attackerEntityId, remaining, now, {
          setLastAttacker: true,
          lastAttackerEntityId: attackerEntityId,
        });
      }
    } else {
      threat = updateThreatFromDamage(
        threat,
        attackerEntityId,
        amt,
        now,
      );
    }
    this.npcThreat.set(targetEntityId, threat);

    st.lastAggroAt = threat.lastAggroAt;
    st.lastAttackerEntityId = threat.lastAttackerEntityId;

    if (proto?.canCallHelp && proto.groupId) {
      this.notifyPackAllies(attackerEntityId, st, proto, {
        snapAllies: false,
      });
    }
  }

  /**
   * Record a healing event for threat purposes.
   *
   * Policy (v0): Healing generates threat on NPCs that are already engaged with either:
   *  - the healed target, or
   *  - the healer
   * within the same room.
   *
   * Threat amount is derived from healAmount * PW_THREAT_HEAL_MULT (default 0.5),
   * clamped to at least 1 when healAmount > 0.
   */
  recordHealing(roomId: string, healerEntityId: string, healedEntityId: string, healAmount: number, now?: number): void {
    const rid = String(roomId ?? "").trim();
    const healerId = String(healerEntityId ?? "").trim();
    const healedId = String(healedEntityId ?? "").trim();
    const amt = Math.max(0, Math.floor(Number(healAmount) || 0));
    if (!rid || !healerId || !healedId || amt <= 0) return;

    const tNow = typeof now === "number" ? now : (this._tickNow || Date.now());

    const healMult = Math.max(0, envNumber("PW_THREAT_HEAL_MULT", 0.5));
    const threatAmt = Math.max(1, Math.floor(amt * healMult));

    // Only apply to NPCs in the room.
    const npcs = this.listNpcsInRoom(rid);
    if (!npcs.length) return;

    for (const st of npcs) {
      const npcId = String((st as any)?.entityId ?? "").trim();
      if (!npcId) continue;

      const proto =
        getNpcPrototype((st as any).templateId) ??
        getNpcPrototype((st as any).protoId) ??
        DEFAULT_NPC_PROTOTYPES[(st as any).templateId] ??
        DEFAULT_NPC_PROTOTYPES[(st as any).protoId];

      // Service-provider NPCs should never gain threat.
      const ent: any = this.entities.get(npcId);
      if (isServiceProtectedNpcProto(proto) || ent?.invulnerable === true) continue;

      const cur = this.npcThreat.get(npcId);
      // Only engaged NPCs care; also avoid waking up neutral NPCs.
      const engagedWithHealed = Math.max(0, getThreatValue(cur, healedId)) > 0;
      const engagedWithHealer = Math.max(0, getThreatValue(cur, healerId)) > 0;
      if (!engagedWithHealed && !engagedWithHealer) continue;

      const next = addThreatValue(cur, healerId, threatAmt, tNow, {
        // Healing threat should not overwrite lastAttacker.
        setLastAttacker: false,
      });
      this.npcThreat.set(npcId, next);

      // Mirror minimal combat state.
      try {
        (st as any).lastAggroAt = (next as any)?.lastAggroAt;
      } catch {
        // ignore
      }
    }
  }

  /**
   * Apply a taunt to an NPC: temporarily force the NPC to focus the taunter.
   * Returns false if the target NPC doesn't exist or cannot be taunted.
   */
  taunt(targetEntityId: string, taunterEntityId: string, opts?: { durationMs?: number; threatBoost?: number }): boolean {
    const st = this.npcsByEntityId.get(targetEntityId);
    if (!st) return false;

    const e = this.entities.get(targetEntityId) as any;
    const proto =
      getNpcPrototype(st.templateId) ??
      getNpcPrototype(st.protoId) ??
      DEFAULT_NPC_PROTOTYPES[st.templateId] ??
      DEFAULT_NPC_PROTOTYPES[st.protoId];

    // Service-provider NPCs are not aggroable/tauntable.
    if (isServiceProtectedNpcProto(proto) || (e as any)?.invulnerable === true) {
      (e as any).invulnerable = true;
      (e as any).isServiceProvider = true;
      return false;
    }

    const threat0 = this.npcThreat.get(targetEntityId);

    const now = this._tickNow || this._simNow || Date.now();

    // Taunt immunity: during the immunity window, ignore new taunts from other entities.
    if (PW_TAUNT_IMMUNITY_MS > 0) {
      const lastTauntAt = typeof (threat0 as any)?.lastTauntAt === "number" ? (threat0 as any).lastTauntAt : 0;
      const forcedTarget = String((threat0 as any)?.forcedTargetEntityId ?? "").trim();
      if (lastTauntAt > 0 && now - lastTauntAt < PW_TAUNT_IMMUNITY_MS && forcedTarget && forcedTarget !== taunterEntityId) {
        return false;
      }
    }

    const threat = applyTauntToThreat(
      threat0,
      taunterEntityId,
      {
        durationMs: opts?.durationMs,
        threatBoost: opts?.threatBoost,
        now,
      },
    );
    this.npcThreat.set(targetEntityId, threat);

    st.lastAggroAt = threat.lastAggroAt;
    st.lastAttackerEntityId = threat.lastAttackerEntityId;

    return true;
  }

  getTopThreatTarget(entityId: string, now: number = Date.now()): string | undefined {
    return getTopThreatTarget(this.npcThreat.get(entityId), now);
  }



  private hasCalledGuardHelp(npcId: string, offenderId: string): boolean {
    return this.guardHelpCalled.get(npcId)?.has(offenderId) ?? false;
  }

  private markGuardHelp(npcId: string, offenderId: string): void {
    let set = this.guardHelpCalled.get(npcId);
    if (!set) {
      set = new Set();
      this.guardHelpCalled.set(npcId, set);
    }
    set.add(offenderId);
  }

  private markPackHelp(npcId: string, offenderId: string, now: number): void {
    let set = this.packHelpCalled.get(npcId);
    if (!set) {
      set = new Set();
      this.packHelpCalled.set(npcId, set);
    }
    set.add(offenderId);

    // Optional TTL for pack-help marks (prevents "never assist again" behavior).
    const ttlMs = Math.max(0, Math.floor(envNumber("PW_ASSIST_MARK_TTL_MS", 0)));
    if (ttlMs > 0) {
      let byOffender = this.packHelpCalledAt.get(npcId);
      if (!byOffender) {
        byOffender = new Map();
        this.packHelpCalledAt.set(npcId, byOffender);
      }
      byOffender.set(offenderId, now);
    }
  }

  private hasMarkedPackHelp(npcId: string, offenderId: string, now: number): boolean {
    const ttlMs = Math.max(0, Math.floor(envNumber("PW_ASSIST_MARK_TTL_MS", 0)));
    if (ttlMs <= 0) return this.packHelpCalled.get(npcId)?.has(offenderId) ?? false;

    const byOffender = this.packHelpCalledAt.get(npcId);
    const last = byOffender?.get(offenderId);
    if (typeof last !== "number") return false;

    if (now - last >= ttlMs) {
      // Expired: clear marks so pack help can happen again.
      byOffender?.delete(offenderId);
      const set = this.packHelpCalled.get(npcId);
      set?.delete(offenderId);
      if (set && set.size === 0) this.packHelpCalled.delete(npcId);
      if (byOffender && byOffender.size === 0) this.packHelpCalledAt.delete(npcId);
      return false;
    }
    return true;
  }

  private moveNpcToRoom(
    state: NpcRuntimeState,
    entityId: string,
    roomId: string,
  ): void {
    if (state.roomId === roomId) return;

    const prevSet = this.npcsByRoom.get(state.roomId);
    if (prevSet) {
      prevSet.delete(entityId);
      if (prevSet.size === 0) this.npcsByRoom.delete(state.roomId);
    }

    let nextSet = this.npcsByRoom.get(roomId);
    if (!nextSet) {
      nextSet = new Set();
      this.npcsByRoom.set(roomId, nextSet);
    }
    nextSet.add(entityId);

    state.roomId = roomId;

    const ent = this.entities.get(entityId);
    if (ent) {
      ent.roomId = roomId;
    }
  }

  private notifyPackAllies(
    attackerEntityId: string,
    st: NpcRuntimeState,
    proto: NpcPrototype,
    opts: { snapAllies: boolean; forceRoomId?: string; sessions?: SessionManager; tickNow?: number },
  ): void {
    if (!proto.canCallHelp) return;

    const attackerRaw = this.entities.get(attackerEntityId);
    const targetRoomId = opts.forceRoomId ?? attackerRaw?.roomId ?? st.roomId;
    // Pack assist can be invoked with an offender id that isn't currently present as an Entity
    // (e.g. lightweight tests or when an offender despawns between ticks). We still want pack
    // assist seeding/snap behavior to function for legacy tests and gate calls, while relying on
    // Engage State Law only for hard visibility stops (stealth) and optional cross-room gating.
    const attacker =
      attackerRaw ??
      ({
        id: attackerEntityId,
        type: "player",
        roomId: targetRoomId,
        hp: 1,
        maxHp: 1,
        alive: true,
      } as any);

    const tickNow =
      typeof (opts as any).tickNow === "number"
        ? (opts as any).tickNow
        : (this._tickNow || this._simNow || Date.now());

    const trainCfg = readTrainConfig();
    const allowCrossRoom = !!(trainCfg.enabled && trainCfg.roomsEnabled);
    // Cross-room assist is only allowed when Train rooms are enabled, OR when the caller provides
    // an explicit forceRoomId (used by gate-home / supernatural calls for help).
    const allowCrossRoomAssist = allowCrossRoom || typeof opts.forceRoomId === "string";

    // Train nuance: even when cross-room assist is enabled, only consider the offender's room if
    // it's within a small grid distance. This prevents "psychic" assists across huge spans.
    // Gate-home calls (forceRoomId) bypass this check on purpose.
    const crossRoomRange = Math.max(0, Math.floor(trainCfg.assistRange));
    const withinCrossRoomRange =
      typeof opts.forceRoomId === "string" ||
      st.roomId === targetRoomId ||
      roomGridDistance(st.roomId, targetRoomId) <= crossRoomRange;

    // Effective cross-room assist flag: Train rooms + within range, or explicit forceRoomId.
    // If the offender's room is out of range, we must behave like cross-room assist is OFF:
    // - don't validate targets cross-room
    // - don't seed threat cross-room
    // - don't snap allies across rooms
    const allowCrossRoomAssistEffective = allowCrossRoomAssist && withinCrossRoomRange;

    const considerRooms = new Set<string>(
      allowCrossRoomAssistEffective ? [st.roomId, targetRoomId] : [st.roomId],
    );


    // Optional offender throttling: prevent multiple pack members from calling help against the
    // same offender within a short window (reduces cascade dogpiles). This is bypassed for
    // explicit forceRoomId calls (gate-home / supernatural calls for help).
    const offenderWindowMs = Math.max(0, Math.floor(envNumber("PW_ASSIST_OFFENDER_WINDOW_MS", 0)));
    // If a prototype has no groupId, scope offender throttling per-caller.
    // Otherwise, missing/undefined groupId would collapse unrelated NPCs into the same
    // "pack" throttle bucket ("undefined:<offender>") and suppress assists in surprising ways.
    const groupKey =
      typeof (proto as any)?.groupId === "string" && String((proto as any).groupId).trim()
        ? String((proto as any).groupId).trim()
        : String(st.entityId);
    const offenderKey = `${groupKey}:${attackerEntityId}`;
    if (offenderWindowMs > 0 && typeof opts.forceRoomId !== "string") {
      const last = this.packHelpOffenderAt.get(offenderKey);
      if (typeof last === "number" && tickNow - last < offenderWindowMs) {
        return;
      }
    }

    // Optional throttling: prevent repeated pack assist waves from the same caller
    // against the same offender within a short window.
    const assistCooldownMs = Math.max(0, Math.floor(envNumber("PW_ASSIST_CALL_COOLDOWN_MS", 0)));
    if (assistCooldownMs > 0) {
      let offenderMap = this.packHelpCallAt.get(st.entityId);
      if (!offenderMap) {
        offenderMap = new Map();
        this.packHelpCallAt.set(st.entityId, offenderMap);
      }
      const last = offenderMap.get(attackerEntityId);
      if (typeof last === "number" && tickNow - last < assistCooldownMs) {
        return;
      }
    }

    // Optional cap: limit how many allies can be assisted per call (threat + snap).
    // 0 means unlimited.
    const maxAlliesPerCall = Math.max(0, Math.floor(envNumber("PW_ASSIST_MAX_ALLIES_PER_CALL", 0)));


    // Threat share amount: scale with the caller's current threat against the offender.
    // Threat share config is read from env at call-time so tests can override it safely.
    const sharePct = Math.max(0, Math.min(1, envNumber("PW_ASSIST_THREAT_SHARE_PCT", 0.5)));
    const shareMin = Math.max(0, envNumber("PW_ASSIST_THREAT_SHARE_MIN", 1));
    const shareMax = Math.max(0, envNumber("PW_ASSIST_THREAT_SHARE_MAX", 50));
    const minThreatDeltaToBump = Math.max(0, envNumber("PW_ASSIST_MIN_THREAT_DELTA_TO_BUMP", 0));

    const callerThreat = this.npcThreat.get(st.entityId);
    const baseThreat = Math.max(0, getThreatValue(callerThreat, attackerEntityId));
    let sharedThreat = shareMin;
    if (baseThreat > 0 && sharePct > 0) {
      sharedThreat = Math.ceil(baseThreat * sharePct);
      sharedThreat = Math.max(shareMin, sharedThreat);
    }
    if (shareMax > 0) {
      sharedThreat = Math.min(shareMax, sharedThreat);
    }

    let assisted = 0;

    for (const room of considerRooms) {
      const allies = this.listNpcsInRoom(room).filter((ally) => {
        if (ally.entityId === st.entityId) return false;
        if (this.hasMarkedPackHelp(ally.entityId, attackerEntityId, tickNow)) return false;

        const allyProto =
          getNpcPrototype(ally.templateId) ??
          getNpcPrototype(ally.protoId) ??
          DEFAULT_NPC_PROTOTYPES[ally.templateId] ??
          DEFAULT_NPC_PROTOTYPES[ally.protoId];

        return proto.groupId ? (allyProto?.groupId === proto.groupId) : (ally.templateId === proto.id);
      });

      // Prioritize allies already engaged with the offender.
      const sortedAllies = [...allies].sort((a, b) => {
        const ta = getThreatValue(this.npcThreat.get(a.entityId), attackerEntityId);
        const tb = getThreatValue(this.npcThreat.get(b.entityId), attackerEntityId);
        if (tb !== ta) return tb - ta;
        return String(a.entityId).localeCompare(String(b.entityId));
      });

      for (const ally of sortedAllies) {
        if (maxAlliesPerCall > 0 && assisted >= maxAlliesPerCall) {
          break;
        }
        // Respect Engage State Law: do not seed pack assist onto invalid targets (stealth/out-of-room/dead/etc).
        const allyEnt = this.entities.get(ally.entityId) ?? ({
          id: ally.entityId,
          type: "npc",
          roomId: ally.roomId,
          hp: (ally as any).hp,
          alive: (ally as any).alive,
        } as any);
        const tv = isValidCombatTarget({
          now: tickNow,
          attacker: allyEnt as any,
          target: attacker as any,
          attackerRoomId: ally.roomId,
          allowCrossRoom: allowCrossRoomAssistEffective,
        });
        // Stealth is a hard stop: never seed threat or snap on an invisible offender.
        if (!tv.ok && (tv as any).reason === "stealth") continue;
        // If cross-room assist is NOT enabled, then any other invalid reason (most
        // commonly out_of_room) must block assist seeding, otherwise NPCs get
        // free radar through walls.
        if (!tv.ok && !allowCrossRoomAssistEffective) continue;

        // Optional anti-jitter: if the ally already has strong threat on the offender, don't
        // bump it again by a small assist seed. This reduces target churn when multiple helpers
        // are already engaged.
        const prevThreat = this.npcThreat.get(ally.entityId);
        const existing = Math.max(0, getThreatValue(prevThreat, attackerEntityId));

        // If the ally already has strong threat on the offender, don't bump it again by a small
        // assist seed. This reduces target churn when multiple helpers are already engaged.
        //
        // IMPORTANT: even if we skip the bump, pack assist must still guarantee a threat bucket
        // exists for the offender (older tests assert that allies "track the attacker").
        let nextThreat = prevThreat;
        const shouldBump = existing === 0 || sharedThreat >= existing + minThreatDeltaToBump;
        if (shouldBump) {
          nextThreat = updateThreatFromDamage(prevThreat, attackerEntityId, sharedThreat, tickNow);
        }

        // Guarantee a seeded bucket for this offender (and lastAttackerEntityId), even when
        // anti-jitter prevents a numerical bump.
        if (getThreatValue(nextThreat, attackerEntityId) <= 0) {
          nextThreat = updateThreatFromDamage(prevThreat, attackerEntityId, Math.max(1, shareMin), tickNow);
        }

        if (nextThreat && nextThreat !== prevThreat) {
          this.npcThreat.set(ally.entityId, nextThreat);
          ally.lastAggroAt = nextThreat.lastAggroAt;
          ally.lastAttackerEntityId = nextThreat.lastAttackerEntityId;
        }

        this.markPackHelp(ally.entityId, attackerEntityId, tickNow);

        assisted += 1;

        if (opts.snapAllies && targetRoomId && (targetRoomId === ally.roomId || allowCrossRoomAssistEffective)) {
          // Do not move an NPC twice in the same tick (prevents leader getting shoved forward by ally-assist).
          if (tickNow && (ally as any).trainMovedAt === tickNow) {
            continue;
          }
          // Only snap across rooms when cross-room assist is effectively enabled.
          // When out of range, allies must remain in their current room.
          if (targetRoomId === ally.roomId || allowCrossRoomAssistEffective) {
            this.moveNpcToRoom(ally, ally.entityId, targetRoomId);
            (ally as any).trainMovedAt = tickNow;
          }
        }
      }
    }

    // Record call timestamp only if we actually assisted at least one ally.
    if (assistCooldownMs > 0 && assisted > 0) {
      let offenderMap = this.packHelpCallAt.get(st.entityId);
      if (!offenderMap) {
        offenderMap = new Map();
        this.packHelpCallAt.set(st.entityId, offenderMap);
      }
      offenderMap.set(attackerEntityId, tickNow);
    }

    if (offenderWindowMs > 0 && typeof opts.forceRoomId !== "string" && assisted > 0) {
      this.packHelpOffenderAt.set(offenderKey, tickNow);
    }
  }

  private maybeCallGuardHelp(
    npcId: string,
    npcEntity: any,
    roomId: string,
    target: any,
    guardProfile: GuardProfile | undefined,
    guardCallRadius: number | undefined,
    sessions?: SessionManager,
  ): void {
    const sessionManager = sessions ?? this.sessions;

    const offenderKey =
      sessionManager?.get(target.ownerSessionId)?.character?.id ??
      target.id;

    if (!offenderKey) return;
    if (this.hasCalledGuardHelp(npcId, offenderKey)) return;

    this.markGuardHelp(npcId, offenderKey);
    this.brain.markCalledHelp(npcId, offenderKey);

    const shout =
      `[guard] ${npcEntity.name ?? "Guard"} yells: ` +
      "To me! Defend the town!";
    this.handleSayDecision(roomId, shout, sessionManager);

    const allies = this.listNpcsInRoom(roomId).filter((ally) => {
      if (ally.entityId === npcId) return false;

      const proto =
        getNpcPrototype(ally.templateId) ??
        getNpcPrototype(ally.protoId) ??
        DEFAULT_NPC_PROTOTYPES[ally.templateId] ??
        DEFAULT_NPC_PROTOTYPES[ally.protoId];

      return proto?.guardProfile !== undefined;
    });

    for (const ally of allies) {
      const threat = updateThreatFromDamage(
        this.npcThreat.get(ally.entityId),
        target.id,
      );
      this.npcThreat.set(ally.entityId, threat);

      const allyProto =
        getNpcPrototype(ally.templateId) ??
        getNpcPrototype(ally.protoId) ??
        DEFAULT_NPC_PROTOTYPES[ally.templateId] ??
        DEFAULT_NPC_PROTOTYPES[ally.protoId];

      const allyGuardProfile = allyProto?.guardProfile;

      const radiusOk =
        guardCallRadius === undefined ||
        allyGuardProfile === undefined ||
        guardCallRadius >= 0; // placeholder for real distance

      if (radiusOk && offenderKey) {
        this.brain.markWarnedTarget(ally.entityId, offenderKey);
        this.brain.markCalledHelp(ally.entityId, offenderKey);
      }
    }
  }

  private maybeGateAndCallHelp(
    st: NpcRuntimeState,
    proto: NpcPrototype,
    threat: NpcThreatState | undefined,
    npcEntity: any,
    sessions?: SessionManager,
  ): boolean {
    const sessionManager = sessions ?? this.sessions;
    if (!proto.canGate) return false;

    const maxHp =
      typeof st.maxHp === "number" && st.maxHp > 0
        ? st.maxHp
        : proto.maxHp || 1;
    const hpPct = st.hp / maxHp;
    const attackerEntityId = threat?.lastAttackerEntityId;

    if (hpPct > 0.3 || !attackerEntityId) return false;
    if (Math.random() > 0.5) return false;

    const spawnRoomId = st.spawnRoomId ?? st.roomId;
    const attackerRoomId =
      this.entities.get(attackerEntityId)?.roomId ?? st.roomId;

    this.handleSayDecision(
      st.roomId,
      `[combat] ${npcEntity.name ?? proto.name} begins casting a gate!`,
      sessionManager,
    );

    this.despawnNpc(st.entityId);

    const spawned = this.spawnNpcById(
      st.templateId,
      spawnRoomId,
      npcEntity.x,
      npcEntity.y,
      npcEntity.z,
      st.variantId,
    );
    if (!spawned) return true;

    const tickNow = this._tickNow || Date.now();
    const threatState = updateThreatFromDamage(
      this.npcThreat.get(spawned.entityId),
      attackerEntityId,
      1,
      tickNow,
    );
    this.npcThreat.set(spawned.entityId, threatState);
    spawned.lastAggroAt = threatState.lastAggroAt;
    spawned.lastAttackerEntityId = threatState.lastAttackerEntityId;

    this.notifyPackAllies(attackerEntityId, spawned, proto, {
      snapAllies: true,
      forceRoomId: attackerRoomId,
      sessions,
      tickNow,
    });

    if (attackerRoomId !== spawnRoomId) {
      this.moveNpcToRoom(spawned, spawned.entityId, attackerRoomId);
    }

    return true;
  }

  getLastAttacker(targetEntityId: string): string | undefined {
    return getLastAttackerFromThreat(this.npcThreat.get(targetEntityId));
  }

  // -------------------------------------------------------------------------
  // Tick update
  // -------------------------------------------------------------------------

  private getShardIdForRoomId(roomId: string): string {
    return parseRoomXY(roomId)?.shard ?? "prime_shard";
  }

  private getNpcAggroModeForRoomId(roomId: string): "default" | "retaliate_only" {
    const shardId = this.getShardIdForRoomId(roomId);

    // Fast path: use cache/overrides synchronously.
    const mode = getNpcAggroModeForRegionSync(shardId, roomId);

    // Runtime: if we have no cached entry yet, kick a best-effort async prefetch
    // so hot loops can remain synchronous while policies still converge quickly.
    try {
      const cached = peekRegionFlagsCache(shardId, roomId);
      if (!cached && process.env.WORLDCORE_TEST !== "1") {
        const k = `${shardId}:${roomId}`;
        const now = this._tickNow || this._simNow || Date.now();
        const last = this.regionFlagsPrefetchAt.get(k) ?? 0;
        // throttle to avoid DB stampedes if many NPCs tick in the same room
        if (now - last > 5_000) {
          this.regionFlagsPrefetchAt.set(k, now);
          void getRegionFlags(shardId, roomId).then(() => {}).catch(() => {});
        }
      }
    } catch {
      // ignore
    }

    return mode;
  }

  private getNpcPursuitProfileForRoomId(roomId: string): "default" | "short" | "train" {
    const shardId = this.getShardIdForRoomId(roomId);

    const profile = getNpcPursuitProfileForRegionSync(shardId, roomId);

    // Same best-effort prefetch strategy as aggroMode so runtime converges without making AI ticks async.
    try {
      const cached = peekRegionFlagsCache(shardId, roomId);
      if (!cached && process.env.WORLDCORE_TEST !== "1") {
        const k = `${shardId}:${roomId}`;
        const now = this._tickNow || this._simNow || Date.now();
        const last = this.regionFlagsPrefetchAt.get(k) ?? 0;
        if (now - last > 5_000) {
          this.regionFlagsPrefetchAt.set(k, now);
          void getRegionFlags(shardId, roomId).then(() => {}).catch(() => {});
        }
      }
    } catch {
      // ignore
    }

    return profile;
  }

  updateAll(deltaMs: number, sessions?: SessionManager): void {
    // Single tick timestamp shared across all NPC decisions this update.
    // Use a simulated monotonic clock so tight-loop tests advance time deterministically.
    if (!this._simNow) this._simNow = Date.now();
    else this._simNow += deltaMs;
    this._tickNow = this._simNow;
    const activeSessions = sessions ?? this.sessions;

    for (const [entityId, st] of this.npcsByEntityId.entries()) {
      const npcEntity: any = this.entities.get(entityId);
      if (!npcEntity) continue;

      const roomId = st.roomId;

      // Resolve prototype (template-first, then protoId, then defaults)
      let proto =
        getNpcPrototype(st.templateId) ??
        getNpcPrototype(st.protoId) ??
        DEFAULT_NPC_PROTOTYPES[st.templateId] ??
        DEFAULT_NPC_PROTOTYPES[st.protoId];

      // Safety: ensure coward_rat always uses its dev proto, even if DB overrides badly.
      if (
        st.protoId === "coward_rat" ||
        st.templateId === "coward_rat"
      ) {
        proto = DEFAULT_NPC_PROTOTYPES["coward_rat"] ?? proto;
      }

      if (!proto) continue;

      const npcAggroMode = this.getNpcAggroModeForRoomId(roomId);
      const pursuitProfile = this.getNpcPursuitProfileForRoomId(roomId);
      const trainCfgBase = applyTrainProfileForRegion(readTrainConfig(), pursuitProfile);

      const trainCfg = (npcAggroMode === "retaliate_only")
        ? { ...trainCfgBase, enabled: false, roomsEnabled: false, assistEnabled: false }
        : trainCfgBase;

      // Town sanctuary recapture (v0): if a hostile (non-guard) is inside a sanctuary tile while NO breach is active,
      // gently push it back toward its spawn room (one tile per tick) and clear combat/threat.
      // This prevents "stuck invaders" after a breach ends without requiring a full event/town defense system.
      {
        const tags = (proto.tags ?? []) as string[];
        const behavior = (proto.behavior ?? "aggressive") as string;
        const isResource =
          tags.includes("resource") ||
          tags.some((t) => String(t).startsWith("resource_"));
        const nonHostile = tags.includes("non_hostile") || isResource;
        const hostile =
          !nonHostile &&
          (behavior === "aggressive" || behavior === "guard" || behavior === "coward");
        const isGuard = tags.includes("guard");

        const curC = this.parseRoomCoord(roomId);
        const inSanctuary = curC ? isTownSanctuaryForRegionSync(curC.shard, roomId) : false;

        if (inSanctuary && hostile && !isGuard) {
          const allowBreach = curC ? allowSiegeBreachForRegionSync(curC.shard, roomId) : false;
          const breachActive =
            !!allowBreach &&
            !!this.townSiege &&
            this.townSiege.isBreachActive(roomId, this._tickNow || Date.now());

          if (!breachActive) {
            const tickNow = this._tickNow || Date.now();
            try {
              this.clearThreat(entityId);
              (st as any).inCombat = false;
              (npcEntity as any).inCombat = false;
              (npcEntity as any).trainChasing = false;
              (npcEntity as any).trainPursueStartAt = 0;
            } catch {
              // best-effort
            }

            const spawnRoomId = String((st as any).spawnRoomId ?? roomId);
            if (trainCfg.roomsEnabled && spawnRoomId && spawnRoomId !== roomId) {
              const next = this.stepRoomToward(roomId, spawnRoomId);
              if (next && next !== roomId) {
                this.moveNpcToRoom(st, entityId, next);
                (st as any).trainMovedAt = tickNow;
                (npcEntity as any).trainMovedAt = tickNow;
                continue;
              }
            }
          }
        }
      }

      // Train return-home drift: when enabled and the NPC is marked as returning, walk back toward spawn.
      // This runs before perception/attack decisions so returning NPCs don't fight while disengaging.
      if (trainCfg.enabled && trainCfg.returnMode === "drift") {
        const returning = !!((st as any).trainReturning || (npcEntity as any).trainReturning);
        if (returning) {
          const threatState = this.npcThreat.get(entityId);
          const hasThreat = !!threatState && Object.keys((threatState as any).threatByEntityId ?? {}).length > 0;
          if (!hasThreat) {
            const spawnRoomId = (st as any).spawnRoomId ?? roomId;
            const curRoomId = String(st.roomId ?? roomId);
            const tickNow = this._tickNow || Date.now();

            // Optional "drift re-aggro" spice: while drifting home, an NPC may pick up new aggro if a player is nearby.
            // This recreates the EverQuest-style "train keeps growing" vibe, but is strictly capped.
            const driftReaggroEnabled = String(process.env.PW_TRAIN_DRIFT_REAGGRO_ENABLED ?? "0") === "1";
            const driftReaggroRange = Math.max(0, Math.floor(Number(process.env.PW_TRAIN_DRIFT_REAGGRO_RANGE_TILES ?? "1")));
            const driftReaggroMaxHops = Math.max(0, Math.floor(Number(process.env.PW_TRAIN_DRIFT_REAGGRO_MAX_HOPS ?? "3")));

            const curHops = Math.max(
              0,
              Math.floor(Number((st as any).trainDriftReaggroHops ?? (npcEntity as any).trainDriftReaggroHops ?? 0)),
            );

            if (driftReaggroEnabled && driftReaggroRange > 0 && driftReaggroMaxHops > 0 && curHops < driftReaggroMaxHops) {
              const player = this.findAnyPlayerWithinRoomRange(curRoomId, driftReaggroRange);
              if (player?.id) {
                // Seed threat and cancel return state; normal perception/Train will resume pursuit.
                this.debugSetThreatValue(entityId, String(player.id), 50, { add: true, now: tickNow });
                (st as any).trainReturning = false;
                (npcEntity as any).trainReturning = false;
                const nextHops = curHops + 1;
                (st as any).trainDriftReaggroHops = nextHops;
                (npcEntity as any).trainDriftReaggroHops = nextHops;
              }
            }

            // If we reacquired threat above, abort the drift hook so normal AI can run.
            const threatState2 = this.npcThreat.get(entityId);
            const hasThreat2 = !!threatState2 && Object.keys((threatState2 as any).threatByEntityId ?? {}).length > 0;
            if (hasThreat2) {
              continue;
            }

            // Room drift: if room pursuit is enabled and we're not at our spawn room, step one tile toward spawn.
            if (trainCfg.roomsEnabled && spawnRoomId && curRoomId && spawnRoomId !== curRoomId) {
              const next = this.stepRoomToward(curRoomId, spawnRoomId);
              if (next && next !== curRoomId) {
                this.moveNpcToRoom(st, entityId, next);
                (st as any).trainMovedAt = tickNow;
                (npcEntity as any).trainMovedAt = tickNow;
              } else {
                // Can't path: stop returning.
                (st as any).trainReturning = false;
                (npcEntity as any).trainReturning = false;
              }
              continue;
            }

            // Same-room drift: walk toward spawn coords.
            const npcX = typeof npcEntity.x === "number" ? npcEntity.x : 0;
            const npcY = typeof npcEntity.y === "number" ? npcEntity.y : 0;
            const npcZ = typeof npcEntity.z === "number" ? npcEntity.z : 0;

            const sx = typeof (npcEntity as any).spawnX === "number" ? (npcEntity as any).spawnX : (typeof (st as any).spawnX === "number" ? (st as any).spawnX : npcX);
            const sy = typeof (npcEntity as any).spawnY === "number" ? (npcEntity as any).spawnY : (typeof (st as any).spawnY === "number" ? (st as any).spawnY : npcY);
            const sz = typeof (npcEntity as any).spawnZ === "number" ? (npcEntity as any).spawnZ : (typeof (st as any).spawnZ === "number" ? (st as any).spawnZ : npcZ);

            const dx = sx - npcX;
            const dz = sz - npcZ;
            const dist = Math.sqrt(dx * dx + dz * dz);
            const eps = 0.25;

            if (dist <= eps) {
              // Arrived: snap final epsilon and clear return flag.
              this.entities.setPosition(entityId, sx, sy, sz);
              (npcEntity as any).x = sx; (npcEntity as any).y = sy; (npcEntity as any).z = sz;
              (st as any).x = sx; (st as any).y = sy; (st as any).z = sz;

              (st as any).trainReturning = false;
              (npcEntity as any).trainReturning = false;
              (npcEntity as any).trainReturnTargetRoomId = undefined;
              (npcEntity as any).trainPursueStartAt = 0;
              (npcEntity as any).trainChasing = false;
              continue;
            }

            const step = Math.max(0, Number(trainCfg.step) || 0);
            if (step <= 0) {
              // No movement configured: stop returning to avoid an infinite stuck state.
              (st as any).trainReturning = false;
              (npcEntity as any).trainReturning = false;
              continue;
            }

            const inv = dist > 0 ? 1 / dist : 0;
            const nx = npcX + dx * inv * step;
            const nz = npcZ + dz * inv * step;
            this.entities.setPosition(entityId, nx, npcY, nz);
            (st as any).trainMovedAt = tickNow;
            (npcEntity as any).trainMovedAt = tickNow;
            continue;
          } else {
            // Threat reacquired: cancel return state.
            (st as any).trainReturning = false;
            (npcEntity as any).trainReturning = false;
          }
        }
      }


      const behavior = proto.behavior ?? "aggressive";
      const guardProfile = proto.guardProfile;
      const guardCallRadius =
        typeof proto.guardCallRadius === "number"
          ? proto.guardCallRadius
          : getGuardCallRadius(guardProfile);

      const roomIsSafeHub = this.isGuardProtectedRoom(proto);
      const npcName = npcEntity.name ?? proto.name;
      const tags = proto.tags ?? [];

      const isResource =
        tags.includes("resource") ||
        tags.some((t) => t.startsWith("resource_"));
      const nonHostile = tags.includes("non_hostile") || isResource;

      // IMPORTANT:
      // - aggressive + guard behave like classic hostiles
      // - coward stays "hostile" so we can still run its brain / flee logic
      const hostile =
        !nonHostile &&
        (behavior === "aggressive" ||
          behavior === "guard" ||
          behavior === "coward");

      let effectiveHostile = hostile;
      if (npcAggroMode === "retaliate_only" && behavior === "aggressive") {
        // Starter-safe belt: no proactive aggro. Retaliation still works via threat/lastAttacker.
        effectiveHostile = false;
      }

      // Guard recapture sweep (opt-in): when a room is a town sanctuary and no breach is active,
      // guards may actively step out to engage nearby hostiles and help "reclaim" the sanctuary.
      // This is intentionally simple: it only runs when guardRecaptureSweep flag is enabled,
      // and uses the existing room-tile chase mechanics.
      {
        const isGuard = (tags as any[]).includes("guard");
        const curC = this.parseRoomCoord(roomId);
        const inSanctuary = curC ? isTownSanctuaryForRegionSync(curC.shard, roomId) : false;

        if (isGuard && inSanctuary && curC && isGuardRecaptureSweepForRegionSync(curC.shard, roomId)) {
          const allowBreach = allowSiegeBreachForRegionSync(curC.shard, roomId);
          const breachActive =
            !!allowBreach &&
            !!this.townSiege &&
            this.townSiege.isBreachActive(roomId, this._tickNow || Date.now());

          if (!breachActive) {
            const rangeTiles = getTownSanctuaryGuardSortieRangeTilesForRegionSync(curC.shard, roomId);
            if (rangeTiles > 0) {
              const targetNpc = this.findAnyHostileNpcWithinRoomRange(roomId, rangeTiles);
              if (targetNpc?.id) {
                // Seed threat on the hostile NPC so the guard will engage.
                const now2 = this._tickNow || Date.now();
                this.debugSetThreatValue(entityId, String(targetNpc.id), 100, { add: true, now: now2 });

                // Step toward the hostile's room if cross-room pursuit is enabled.
                const trgRoom = String((targetNpc as any).roomId ?? "");
                if (trainCfg.roomsEnabled && trgRoom && trgRoom !== roomId) {
                  const next = this.stepRoomToward(roomId, trgRoom);
                  if (next && next !== roomId) {
                    this.moveNpcToRoom(st, entityId, next);
                    (st as any).trainMovedAt = now2;
                    (npcEntity as any).trainMovedAt = now2;
                  }
                }
              }
            }
          }
        }
      }



      // Fear: when present, NPC attempts to flee one room tile away from its current threat target.
      // This runs before perception/attacks so fear cleanly suppresses engagement.
      {
        const tickNow = this._tickNow || Date.now();
        let feared = false;
        try {
          const activeFx = getActiveStatusEffectsForEntity(npcEntity as any, tickNow);
          feared = activeFx.some((fx) => Array.isArray((fx as any).tags) && (fx as any).tags.includes("fear"));
        } catch {
          feared = false;
        }

        if (feared) {
          if (trainCfg.enabled && trainCfg.roomsEnabled) {
            // Pick a flee anchor: top threat target if known, otherwise stay deterministic via spawn.
            const threatState = this.npcThreat.get(entityId) as any;
            let anchorRoomId = String((st as any).spawnRoomId ?? roomId);

            let bestId: string | null = null;
            let bestThreat = -Infinity;
            const tmap = (threatState?.threatByEntityId ?? {}) as Record<string, number>;
            for (const [tid, val] of Object.entries(tmap)) {
              const v = Number(val);
              if (!Number.isFinite(v)) continue;
              if (v > bestThreat) {
                bestThreat = v;
                bestId = String(tid);
              }
            }
            if (bestId) {
              const te = this.entities.get(bestId);
              if (te?.roomId) anchorRoomId = String(te.roomId);
            }

            const next = this.stepRoomAway(String(st.roomId ?? roomId), anchorRoomId);
            if (next && next !== String(st.roomId ?? roomId)) {
              this.moveNpcToRoom(st, entityId, next);
              (st as any).trainMovedAt = tickNow;
              (npcEntity as any).trainMovedAt = tickNow;
              // While feared, do nothing else this tick.
              continue;
            }
          }

          // No room movement: still suppress engagement.
          (st as any).inCombat = false;
          (npcEntity as any).inCombat = false;
        }
      }

      const threat0 = this.npcThreat.get(entityId);
      const now = this._tickNow || Date.now();

      // NOTE: threat decay is applied after we build room perception so we can
      // apply role-aware + out-of-sight policy (tank holds longer, out_of_room decays harder).
      let threat = threat0;

      // Build perception
      const playersInRoom: PerceivedPlayer[] = [];
      let topThreatId: string | undefined;
      try {
        const ents = this.entities.getEntitiesInRoom(roomId) as any[];

        // Resolve current target with visibility rules (stealth/out-of-room/dead).
        const byId = new Map<string, any>();

        for (const e of ents) {
          if (e?.id) byId.set(String(e.id), e);
        }

        // Apply deterministic threat decay with policy inputs derived from current perception.
        const decayed = decayThreat(threat, {
          now,
          getRoleForEntityId: (id: string) => {
            const e = byId.get(String(id)) ?? this.entities.get(String(id));
            const session =
              e?.ownerSessionId && activeSessions
                ? activeSessions.get(e.ownerSessionId)
                : undefined;
            const char = session?.character;
            return char ? getCombatRoleForClass(char.classId) : undefined;
          },
          validateTarget: (id: string) => {
            let e = byId.get(String(id));
            if (!e && trainCfg.enabled && trainCfg.roomsEnabled) {
              e = this.entities.get(String(id));
            }

            const allowCrossRoom = trainCfg.enabled && trainCfg.roomsEnabled;
            const v = isValidCombatTarget({
              now,
              attacker: npcEntity as any,
              target: e as any,
              attackerRoomId: roomId,
              allowCrossRoom,
            });
            if (!v.ok) return { ok: false, reason: v.reason };
            return { ok: true };
          },
        });

        if (decayed && decayed !== threat) {
          threat = decayed;
          this.npcThreat.set(entityId, threat);
        }

        const sel = selectThreatTarget(threat, now, (id) => {
          let e = byId.get(String(id));
          if (!e && trainCfg.enabled && trainCfg.roomsEnabled) {
            e = this.entities.get(String(id));
          }

          const allowCrossRoom = trainCfg.enabled && trainCfg.roomsEnabled;
          const v = isValidCombatTarget({
            now,
            attacker: npcEntity as any,
            target: e as any,
            attackerRoomId: roomId,
            allowCrossRoom,
          });
          if (!v.ok) return { ok: false, reason: v.reason };

          return { ok: true };
        });

        topThreatId = sel.targetId;
        if (sel.nextThreat && sel.nextThreat !== threat) {
          this.npcThreat.set(entityId, sel.nextThreat);
        }

        for (const e of ents) {
          if (e.type !== "player") continue;

          const maxHp =
            typeof e.maxHp === "number" && e.maxHp > 0
              ? e.maxHp
              : 100;
          const hp =
            typeof e.hp === "number" ? e.hp : maxHp;

          const session =
            e.ownerSessionId && activeSessions
              ? activeSessions.get(e.ownerSessionId)
              : undefined;
          const char = session?.character;

          playersInRoom.push({
            entityId: e.id,
            characterId: char?.id ?? (e as any).characterId,
            hp,
            maxHp,
            recentCrimeUntil: char?.recentCrimeUntil,
            recentCrimeSeverity: char?.recentCrimeSeverity,
            combatRole: char
              ? getCombatRoleForClass(char.classId)
              : undefined,
          });
        }

        if (topThreatId) {
          playersInRoom.sort((a, b) => {
            if (a.entityId === topThreatId) return -1;
            if (b.entityId === topThreatId) return 1;
            return 0;
          });
        }
      } catch (err) {
        log.warn("Failed to build NPC perception", { entityId, err });
        continue;
      }

      const perception: NpcPerception = {
        npcId: entityId,
        entityId,
        roomId,
        hp: st.hp,
        maxHp: st.maxHp,
        alive: st.alive,
        behavior,
        guardProfile,
        guardCallRadius,
        roomIsSafeHub,
        npcName,
        hostile: effectiveHostile,
        currentTargetId: topThreatId,
        playersInRoom,
        sinceLastDecisionMs: deltaMs,
        lastAggroAt: threat?.lastAggroAt,
        lastAttackerId: threat?.lastAttackerEntityId,
      };

      // Town sanctuary guard sortie: when enabled, guards inside a sanctuary tile may step out
      // to engage nearby active threats (typically hostiles fighting players just outside town).
      //
      // This is intentionally conservative:
      // - only guards (behavior="guard")
      // - only when the guard's current tile is a sanctuary
      // - only when flags explicitly allow sortie
      // - only looks a small number of adjacent tiles
      //
      // If a threat is found, the guard seeds threat onto the hostile NPC and moves to its room.
      if (behavior === "guard") {
        const curC = this.parseRoomCoord(roomId);
        if (!curC) {
          // Cannot evaluate sanctuary/sortie rules without a coord.
        } else {
        const curIsSanctuary = isTownSanctuaryForRegionSync(curC.shard, roomId);
        const sortieEnabled = isTownSanctuaryGuardSortieForRegionSync(curC.shard, roomId);

        if (curIsSanctuary && sortieEnabled) {
          const tickNow = this._tickNow || Date.now();

          const baseRangeTiles = getTownSanctuaryGuardSortieRangeTilesForRegionSync(curC.shard, roomId);
          const siegeActive = !!(this.townSiege && this.townSiege.isUnderSiege(roomId, tickNow));
          const siegeBonus = siegeActive ? this.readTownSiegeGuardSortieBonusTiles() : 0;
          const moraleCfg = this.readTownSiegeGuardMoraleProactive();

          const maxRange = Math.max(0, Math.floor(baseRangeTiles) + siegeBonus);

          // Only meaningful with room movement enabled.
          if (maxRange > 0 && trainCfg.enabled && trainCfg.roomsEnabled) {

            // Scan nearby rooms for a hostile NPC with player-target threat.
            let foundHostileNpc: { roomId: string; npcId: string } | null = null;

            for (let dx = -maxRange; dx <= maxRange && !foundHostileNpc; dx++) {
              for (let dz = -maxRange; dz <= maxRange && !foundHostileNpc; dz++) {
                if (dx === 0 && dz === 0) continue;

                const candidateRoomId = this.formatRoomCoord({
                  shard: curC.shard,
                  x: curC.x + dx,
                  z: curC.z + dz,
                });

                // Do not sortie *into* sanctuary tiles (guards can still operate there normally).
                const candIsSanctuary = isTownSanctuaryForRegionSync(curC.shard, candidateRoomId);
                if (candIsSanctuary) continue;

                const npcsThere = this.listNpcsInRoom(candidateRoomId);
                for (const other of npcsThere) {
                  if (!other?.entityId) continue;
                  if (String(other.entityId) === String(entityId)) continue;

                  const otherProto =
                    getNpcPrototype(other.templateId) ??
                    getNpcPrototype(other.protoId) ??
                    DEFAULT_NPC_PROTOTYPES[other.templateId] ??
                    DEFAULT_NPC_PROTOTYPES[other.protoId];

                  const otherBehavior = (otherProto as any)?.behavior;
                  const otherTags = Array.isArray((otherProto as any)?.tags) ? (otherProto as any).tags : [];
                  const otherIsGuard = otherBehavior === "guard" || otherTags.includes("guard");
                  if (otherIsGuard) continue;

                  // Only react to clearly hostile behaviors.
                  const otherHostile = otherBehavior === "aggressive" || otherBehavior === "coward" || otherTags.includes("hostile");
                  if (!otherHostile) continue;

                  const otherThreat = this.npcThreat.get(other.entityId) as any;
                  const table = otherThreat?.threatByEntityId ?? {};
                  const keys = Object.keys(table);
                  if (keys.length === 0) {
                    const proactive = moraleCfg.enabled && siegeActive;
                    if (!proactive) continue;

                    const otherEnt = this.entities.get(String(other.entityId)) as any;
                    const inCombat = !!(otherEnt && (otherEnt.inCombat === true || (otherEnt as any).inCombat === true));

                    const lastAggroAt = Number(otherThreat?.lastAggroAt ?? 0);
                    const recentlyAggro = Number.isFinite(lastAggroAt)
                      ? tickNow - lastAggroAt <= moraleCfg.recentAggroWindowMs
                      : false;

                    if (!inCombat && !recentlyAggro) continue;
                  }

                  // Default: only sortie to hostiles that are actively fighting a player.
                  // Under siege, guard morale can be configured to allow proactive engagement of
                  // recently-aggressive hostiles even if they are not currently targeting a player.
                  const hasPlayerTarget = keys.some((tid) => {
                    const te = this.entities.get(String(tid));
                    return te?.type === "player";
                  });

                  if (!hasPlayerTarget) {
                    const proactive = moraleCfg.enabled && siegeActive;
                    if (!proactive) continue;

                    const otherEnt = this.entities.get(String(other.entityId)) as any;
                    const inCombat = !!(otherEnt && (otherEnt.inCombat === true || (otherEnt as any).inCombat === true));

                    const lastAggroAt = Number(otherThreat?.lastAggroAt ?? 0);
                    const recentlyAggro = Number.isFinite(lastAggroAt)
                      ? tickNow - lastAggroAt <= moraleCfg.recentAggroWindowMs
                      : false;

                    if (!inCombat && !recentlyAggro) continue;
                  }

                  foundHostileNpc = { roomId: candidateRoomId, npcId: String(other.entityId) };
                  break;
                }
              }
            }

            if (foundHostileNpc) {
              // Seed threat onto the hostile NPC so guard brains can swing.
              this.npcThreat.set(entityId, {
                lastAttackerEntityId: foundHostileNpc.npcId,
                lastAggroAt: tickNow,
                threatByEntityId: { [foundHostileNpc.npcId]: 100 },
              } as any);

              (st as any).inCombat = true;
              (npcEntity as any).inCombat = true;

              // Move guard to the hostile's room.
              if (foundHostileNpc.roomId && foundHostileNpc.roomId !== roomId) {
                if ((st as any).trainMovedAt !== tickNow) {
                  this.moveNpcToRoom(st, entityId, foundHostileNpc.roomId);
                  (st as any).trainMovedAt = tickNow;
                  (npcEntity as any).trainMovedAt = tickNow;
                }
              }
              continue;
            }
          }
        }
        }
      }


      // Train System pre-hook: chase even when the target is not in playersInRoom (cross-room),
      // and before any brain decision. This is required for room-tile pursuit.
      if (trainCfg.enabled && topThreatId) {
        const targetEntity = this.entities.get(String(topThreatId));
        if (targetEntity && targetEntity.alive !== false && !(typeof targetEntity.hp === "number" && targetEntity.hp <= 0)) {
          const didChase = this.maybeTrainChase({
            npcId: entityId,
            st,
            npcEntity,
            targetEntity,
            roomId,
            now: this._tickNow,
            cfg: trainCfg,
            sessions,
          });
          if (didChase) {
            // We moved (or disengaged) this tick; skip standard AI decisions.
            continue;
          }
        }
      }

      // --- HARD OVERRIDE for cowards: flee when hurt, no debate ---
      if (
        behavior === "coward" &&
        st.alive &&
        st.maxHp > 0 &&
        st.hp < st.maxHp
      ) {
        this.handleFleeDecision(
          entityId,
          st,
          npcEntity,
          roomId,
          behavior,
          activeSessions,
        );
        continue;
      }

      if (
        npcAggroMode !== "retaliate_only" &&
        this.maybeGateAndCallHelp(
          st,
          proto,
          threat,
          npcEntity,
          activeSessions,
        )
      ) {
        continue;
      }

      let decision = this.brain.decide(perception, deltaMs);
      const forced = this.fallbackAttackDecision(perception, st, decision);
      if (forced) decision = forced;
      if (!decision) continue;

      switch (decision.kind) {
        case "flee":
          this.handleFleeDecision(
            entityId,
            st,
            npcEntity,
            roomId,
            behavior,
            activeSessions,
          );
          break;

        case "say":
          this.handleSayDecision(roomId, decision.text, activeSessions);
          break;

        case "attack_entity":
          this.handleAttackEntityDecision(
            entityId,
            st,
            npcEntity,
            roomId,
            behavior,
            decision.targetEntityId,
            guardProfile,
            guardCallRadius,
            activeSessions,
          );
          break;

        default:
          // idle / move_to_room not yet implemented
          break;
      }
    }
    // Clear tick stamp after update completes.
    this._tickNow = 0;
  }

  // -------------------------------------------------------------------------
  // Internal AI helpers
  /**
   * Fallback: if the AI brain returns no decision (or only a "say"/idle),
   * we still want obvious hostile reactions to happen immediately.
   *
   * - Guards retaliate on **severe** recent crime.
   * - Aggressive/pack mobs swing at the current threat leader.
   *
   * This is intentionally conservative: it only triggers for behaviors that are allowed to attack,
   * and only when there's a clear target in-room.
   */
  private fallbackAttackDecision(
    perception: NpcPerception,
    st: NpcRuntimeState,
    currentDecision: any | null | undefined,
  ): { kind: "attack_entity"; targetEntityId: string } | null {
    if (!perception.alive) return null;

    const behavior = perception.behavior;
    if (behavior !== "aggressive" && behavior !== "guard") return null;

    const kind = currentDecision?.kind;
    if (kind === "attack_entity" || kind === "flee" || kind === "gate_home") return null;

    const now = this._tickNow || Date.now();

    // Prevent rapid-fire fallback swings (brain may be in a think/cooldown window).
    const last = (st as any).lastFallbackAttackAt ?? 0;
    const cooldownMs = 800;
    if (last && now - last < cooldownMs) return null;

    if (behavior === "guard") {
      const offender = perception.playersInRoom.find((p) => {
        const until = typeof (p as any).recentCrimeUntil === "number" ? (p as any).recentCrimeUntil : 0;
        const sev = (p as any).recentCrimeSeverity;
        return until > now && sev === "severe";
      });

      if (!offender?.entityId) return null;

      (st as any).lastFallbackAttackAt = now;
      return { kind: "attack_entity", targetEntityId: offender.entityId };
    }

    // Aggressive/pack mobs: attack the current threat leader if present in the room.
    const targetId = (perception as any).lastAttackerId;
    if (typeof targetId !== "string" || !targetId) return null;

    const present = perception.playersInRoom.some((p) => p.entityId === targetId);
    if (!present) return null;

    (st as any).lastFallbackAttackAt = now;
    return { kind: "attack_entity", targetEntityId: targetId };
  }

  // -------------------------------------------------------------------------

  private handleFleeDecision(
    npcId: string,
    st: NpcRuntimeState,
    npcEntity: any,
    roomId: string,
    behavior: string,
    sessions?: SessionManager,
  ): void {
    const sessionManager = sessions ?? this.sessions;
    st.fleeing = true;

    if (sessionManager) {
      try {
        const ents = this.entities.getEntitiesInRoom(roomId) as any[];
        const player = ents.find((e) => e.type === "player");
        if (player && player.ownerSessionId) {
          const s = sessionManager.get(player.ownerSessionId);
          if (s) {
            sessionManager.send(s, "chat", {
              from: "[world]",
              sessionId: "system",
              text: `[combat] ${npcEntity.name} squeals and scurries away!`,
              t: Date.now(),
            });
          }
        }
      } catch {
        // if this blows up, fleeing still works; we just lose flavor text
      }
    }

    log.info("NPC fleeing and despawning", {
      npcId,
      roomId,
      behavior,
      hp: st.hp,
      maxHp: st.maxHp,
    });

    // Remove from the world; clients will see an entity_despawn.
    this.despawnNpc(npcId);
  }

  private handleSayDecision(
    roomId: string,
    text: string,
    sessions?: SessionManager,
  ): void {
    const sessionManager = sessions ?? this.sessions;
    if (!sessionManager) return;

    try {
      const ents = this.entities.getEntitiesInRoom(roomId) as any[];
      for (const e of ents) {
        if (e.type !== "player") continue;

        const ownerSessionId = e.ownerSessionId;
        if (!ownerSessionId) continue;

        const s = sessionManager.get(ownerSessionId);
        if (s) {
          sessionManager.send(s, "chat", {
            from: "[world]",
            sessionId: "system",
            text,
            t: Date.now(),
          });
        }
      }
    } catch {
      // chat is best-effort
    }
  }

  private handleAttackEntityDecision(
    npcId: string,
    st: NpcRuntimeState,
    npcEntity: any,
    roomId: string,
    behavior: string,
    targetEntityId: string,
    guardProfile?: GuardProfile,
    guardCallRadius?: number,
    sessions?: SessionManager,
  ): void {
    const sessionManager = sessions ?? this.sessions;
    const target = this.entities.get(targetEntityId) as any;
    if (!target || target.type !== "player") {
      return;
    }

    // Engage State Law v1: central target validity (stealth/protected/out-of-room).
    const now = this._tickNow || Date.now();
    const trainCfg = readTrainConfig();
    const allowCrossRoom = trainCfg.enabled && trainCfg.roomsEnabled;

    const v = isValidCombatTarget({
      now,
      attacker: npcEntity as any,
      target: target as any,
      attackerRoomId: roomId,
      allowCrossRoom,
    });
    if (!v.ok) {
      return;
    }

    // Even when room pursuit is enabled, melee swings still require same-room presence.
    if (String(target.roomId ?? "") !== String(roomId ?? "")) {
      return;
    }

    const isGuard = behavior === "guard";
    const isCoward =
      behavior === "coward" ||
      st.protoId === "coward_rat" ||
      st.templateId === "coward_rat";

    // Figure out the NPC's *real* current HP from the entity, falling back to state
    const currentNpcHp =
      typeof npcEntity.hp === "number" ? npcEntity.hp : st.hp;
    const currentNpcMaxHp =
      typeof npcEntity.maxHp === "number" && npcEntity.maxHp > 0
        ? npcEntity.maxHp
        : st.maxHp || DEFAULT_NPC_PROTOTYPES[st.templateId]?.maxHp;

    // Keep state in sync so future checks see the same numbers
    st.hp = currentNpcHp;
    st.maxHp = currentNpcMaxHp ?? st.maxHp;
    st.alive = currentNpcHp > 0;

    npcEntity.hp = currentNpcHp;
    npcEntity.maxHp = currentNpcMaxHp;
    npcEntity.alive = st.alive;

    const npcHpDebug =
      (isCoward || isGuard) && currentNpcMaxHp
        ? ` [npc_hp=${currentNpcHp}/${currentNpcMaxHp} beh=${behavior}]`
        : "";

    // Extra safety: if somehow a coward reaches this branch while hurt,
    // force them to flee instead of attacking.
    if (
      isCoward &&
      st.alive &&
      currentNpcMaxHp &&
      currentNpcHp < currentNpcMaxHp
    ) {
      st.fleeing = true;

      if (sessions) {
        const ownerSessionId = (target as any).ownerSessionId;
        if (ownerSessionId) {
          const s = sessions.get(ownerSessionId);
          if (s) {
            sessions.send(s, "chat", {
              from: "[world]",
              sessionId: "system",
              text: `[combat] ${npcEntity.name} squeals and scurries away!${npcHpDebug}`,
              t: Date.now(),
            });
          }
        }
      }

      log.info("Coward NPC fleeing and despawning (attack branch)", {
        npcId,
        roomId,
        hp: currentNpcHp,
        maxHp: currentNpcMaxHp,
      });

      this.despawnNpc(npcId);
      return;
    }

    // ---------- Normal attack path (non-cowards, or unharmed cowards) ----------
    const targetMaxHp =
      typeof target.maxHp === "number" && target.maxHp > 0
        ? target.maxHp
        : 100;
    const targetHp =
      typeof target.hp === "number" ? target.hp : targetMaxHp;

    if (targetHp <= 0) {
      return;
    }


    // AIv2 melee range gate: prevent global-room sniping.
    // If the target is outside melee range OR in a different room, we either chase (Train System)
    // or skip this tick (classic behavior).
    const npcX = typeof npcEntity.x === "number" ? npcEntity.x : 0;
    const npcY = typeof npcEntity.y === "number" ? npcEntity.y : 0;
    const npcZ = typeof npcEntity.z === "number" ? npcEntity.z : 0;
    const tgtX = typeof target.x === "number" ? target.x : 0;
    const tgtY = typeof target.y === "number" ? target.y : 0;
    const tgtZ = typeof target.z === "number" ? target.z : 0;
    const MELEE_RANGE = 4;

    const targetRoomId = String((target as any).roomId ?? (target as any).roomKey ?? "");
    const roomsDiffer = !!targetRoomId && targetRoomId !== roomId;

    const dx = npcX - tgtX;
    const dz = npcZ - tgtZ;
    const distSq = dx * dx + dz * dz;

    if (roomsDiffer || distSq > MELEE_RANGE * MELEE_RANGE) {
      // Train chase (soft leash / room pursuit) is handled by the Train pre-hook earlier in this tick.
      // If we are out of melee range (or in a different room), we do not melee here.
      return;
    }

    if (isGuard) {
      this.maybeCallGuardHelp(
        npcId,
        npcEntity,
        roomId,
        target,
        guardProfile,
        guardCallRadius,
        sessionManager,
      );
    }

    let targetSession: any | null = null;
    let targetChar: CharacterState | undefined;

    const ownerSessionId = (target as any).ownerSessionId;
    if (sessionManager && ownerSessionId) {
      const s = sessionManager.get(ownerSessionId);
      if (s) {
        targetSession = s;
        targetChar = (s.character ?? undefined) as any;
      }
    }

    const dmg = computeNpcMeleeDamage(npcEntity);
    const { newHp, maxHp, killed } = applySimpleDamageToPlayer(
      target,
      dmg,
      targetChar,
      "physical",
    );

    // Tag NPC as in combat as well
    markInCombat(npcEntity);

    let line: string;
    if (killed) {
      line =
        `[combat][AIv2${npcHpDebug}] ${npcEntity.name} hits you for ${dmg} damage.\n` +
        `You die. (0/${maxHp} HP) ` +
        "Use 'respawn' to return to safety or wait for someone to resurrect you.";
    } else {
      line =
        `[combat][AIv2${npcHpDebug}] ${npcEntity.name} hits you for ${dmg} damage.\n` +
        `(${newHp}/${maxHp} HP)`;
    }

    if (sessionManager && targetSession) {
      sessionManager.send(targetSession, "chat", {
        from: "[world]",
        sessionId: "system",
        text: line,
        t: Date.now(),
      });
    }
  }

  
  // -------------------------------------------------------------------------
  // Train System v0 (same-room pursuit + soft/hard leash)
  // -------------------------------------------------------------------------

  private parseRoomCoord(roomId: string): { shard: string; x: number; z: number } | null {
    // Expected: "shard:x,z" (e.g. prime_shard:0,0)
    const raw = String(roomId || "");
    const idx = raw.indexOf(":");
    if (idx <= 0) return null;
    const shard = raw.slice(0, idx);
    const rest = raw.slice(idx + 1);
    const parts = rest.split(",");
    if (parts.length !== 2) return null;
    const x = Number(parts[0]);
    const z = Number(parts[1]);
    if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
    return { shard, x, z };
  }

  private formatRoomCoord(coord: { shard: string; x: number; z: number }): string {
    return `${coord.shard}:${coord.x},${coord.z}`;
  }

  private stepRoomToward(currentRoomId: string, targetRoomId: string): string | null {
    const cur = this.parseRoomCoord(currentRoomId);
    const tgt = this.parseRoomCoord(targetRoomId);
    if (!cur || !tgt) return null;
    if (cur.shard !== tgt.shard) return null;
    const dx = tgt.x - cur.x;
    const dz = tgt.z - cur.z;
    if (dx === 0 && dz === 0) return currentRoomId;
    // Move exactly one tile per tick; prefer X movement, then Z.
    let nx = cur.x;
    let nz = cur.z;
    if (dx !== 0) nx += Math.sign(dx);
    else nz += Math.sign(dz);
    return this.formatRoomCoord({ shard: cur.shard, x: nx, z: nz });
  }


  private stepRoomAway(currentRoomId: string, targetRoomId: string): string | null {
    const cur = this.parseRoomCoord(currentRoomId);
    const tgt = this.parseRoomCoord(targetRoomId);
    if (!cur || !tgt) return null;
    if (cur.shard !== tgt.shard) return null;
    const dx = tgt.x - cur.x;
    const dz = tgt.z - cur.z;
    if (dx == 0 && dz == 0) return currentRoomId;
    // Move exactly one tile per tick; prefer X movement, then Z.
    let nx = cur.x;
    let nz = cur.z;
    if (dx !== 0) nx -= Math.sign(dx);
    else nz -= Math.sign(dz);
    return this.formatRoomCoord({ shard: cur.shard, x: nx, z: nz });
  }

  private findAnyPlayerWithinRoomRange(centerRoomId: string, rangeTiles: number): any | null {
    const c = this.parseRoomCoord(centerRoomId);
    if (!c) return null;
    const r = Math.max(0, Math.floor(rangeTiles));
    if (r <= 0) return null;

    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        // Manhattan-ish circle: keep it cheap and deterministic.
        if (Math.abs(dx) + Math.abs(dz) > r) continue;
        const roomId = this.formatRoomCoord({ shard: c.shard, x: c.x + dx, z: c.z + dz });
        let ents: any[] = [];
        try {
          ents = (this.entities.getEntitiesInRoom(roomId) as any[]) ?? [];
        } catch {
          ents = [];
        }
        for (const e of ents) {
          if (!e) continue;
          const kind = String((e as any).kind ?? (e as any).type ?? "");
          const ownerSessionId = (e as any).ownerSessionId;
          const isPlayer = kind === "player" || kind === "character" || !!ownerSessionId;
          if (isPlayer) return e;
        }
      }
    }
    return null;
  }

  private findAnyHostileNpcWithinRoomRange(centerRoomId: string, rangeTiles: number): any | null {
    const c = this.parseRoomCoord(centerRoomId);
    if (!c) return null;
    const r = Math.max(0, Math.floor(rangeTiles));
    if (r <= 0) return null;

    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (Math.abs(dx) + Math.abs(dz) > r) continue;
        const roomId = this.formatRoomCoord({ shard: c.shard, x: c.x + dx, z: c.z + dz });
        let ents: any[] = [];
        try {
          ents = (this.entities.getEntitiesInRoom(roomId) as any[]) ?? [];
        } catch {
          ents = [];
        }
        for (const e of ents) {
          if (!e || !e.id) continue;
          const id = String(e.id);
          // Only consider NPCs tracked by NpcManager runtime state.
          if (!this.npcsByEntityId.has(id)) continue;

          const st = this.npcsByEntityId.get(id) as any;
          const proto =
            getNpcPrototype(st?.templateId) ??
            getNpcPrototype(st?.protoId) ??
            DEFAULT_NPC_PROTOTYPES[st?.templateId] ??
            DEFAULT_NPC_PROTOTYPES[st?.protoId];
          if (!proto) continue;

          const tags = (proto.tags ?? []) as string[];
          if (tags.includes("guard")) continue;

          const behavior = String(proto.behavior ?? "aggressive");
          const isResource =
            tags.includes("resource") || tags.some((t) => String(t).startsWith("resource_"));
          const nonHostile = tags.includes("non_hostile") || isResource;
          const hostile =
            !nonHostile && (behavior === "aggressive" || behavior === "guard" || behavior === "coward");
          if (!hostile) continue;

          return e;
        }
      }
    }

    return null;
  }

  private maybeTrainChase(args: {
    npcId: string;
    st: NpcRuntimeState;
    npcEntity: any;
    targetEntity: any;
    roomId: string;
    now: number;
    cfg: TrainConfig;
    sessions?: SessionManager;
  }): boolean {
    const { npcId, st, npcEntity, targetEntity: target, roomId, now, cfg, sessions } = args;

    // Use a stable tick timestamp if updateAll() provided one; this prevents double-moves when Train is invoked from multiple gates.
    const tickNow = this._tickNow || now;
    if ((st as any).trainMovedAt === tickNow) return true;
// v0.1 optionally allows cross-room pursuit.
    const targetRoom = String((target as any).roomId ?? (target as any).roomKey ?? "");
    if (targetRoom && targetRoom !== roomId) {
      if (!cfg.roomsEnabled) return false;

      const nextRoomId = this.stepRoomToward(roomId, targetRoom);
      if (!nextRoomId) return false;

      // Town sanctuary boundary: hostile NPCs (non-guards) must not enter sanctuary regions via Train pursuit.
      const nextC_forSanctuary = this.parseRoomCoord(nextRoomId);
      const isSanctuary = nextC_forSanctuary
        ? isTownSanctuaryForRegionSync(nextC_forSanctuary.shard, nextRoomId)
        : false;

      if (isSanctuary) {
        const protoForTags =
          getNpcPrototype(st.templateId) ??
          getNpcPrototype(st.protoId) ??
          DEFAULT_NPC_PROTOTYPES[st.templateId] ??
          DEFAULT_NPC_PROTOTYPES[st.protoId];

        const tags = Array.isArray((protoForTags as any)?.tags) ? (protoForTags as any).tags : [];
        const isGuard = tags.includes("guard");

        const allowBreach = nextC_forSanctuary
          ? allowSiegeBreachForRegionSync(nextC_forSanctuary.shard, nextRoomId)
          : false;

        if (!isGuard && !(allowBreach && this.townSiege && this.townSiege.isBreachActive(nextRoomId, tickNow))) {
          // Sanctuary pressure: blocked trains contribute to a rolling pressure window which can trigger a siege event.
          this.recordTownSanctuaryPressure(nextRoomId, tickNow);
          try {
            this.clearThreat(npcId);
            (st as any).inCombat = false;
            (npcEntity as any).inCombat = false;
            (npcEntity as any).trainChasing = false;
            (npcEntity as any).trainPursueStartAt = 0;
            (st as any).trainMovedAt = tickNow;
          } catch {
            // best-effort
          }
          return true;
        }
      }

      // Bound pursuit by max rooms away from spawn.
      const spawnRoomId = (st as any).spawnRoomId as string | undefined;
      const spawnC = spawnRoomId ? this.parseRoomCoord(spawnRoomId) : null;
      const nextC = this.parseRoomCoord(nextRoomId);
      if (spawnC && nextC) {
        const max = Math.max(0, Math.floor(cfg.maxRoomsFromSpawn));
        if (max > 0) {
          const dxRooms = Math.abs(nextC.x - spawnC.x);
          const dzRooms = Math.abs(nextC.z - spawnC.z);
          if (dxRooms > max || dzRooms > max) {
            // Past the allowed pursuit box: disengage + snapback.
            try {
              this.clearThreat(npcId);
              (st as any).inCombat = false;
              if (spawnRoomId && spawnRoomId !== roomId) {
                this.moveNpcToRoom(st, npcId, spawnRoomId);
              }
            } catch {
              // best-effort
            }
            return true;
          }
        }
      }

      const oldRoomId = roomId;

      // Assist snap: use existing pack-help semantics (groupId + canCallHelp) and SNAP allies into the pursuit room.
      // We do this BEFORE moving the leader, so allies can be found in the origin room and moved into nextRoomId.
      // Reserve this NPC's move for this tick so pack-assist cannot "boost" the leader into a second room.
      (st as any).trainMovedAt = tickNow;
      if (!isSanctuary && cfg.assistEnabled && cfg.assistSnapAllies) {
        const proto =
          getNpcPrototype(st.templateId) ??
          getNpcPrototype(st.protoId) ??
          DEFAULT_NPC_PROTOTYPES[st.templateId] ??
          DEFAULT_NPC_PROTOTYPES[st.protoId];

        if (proto) {
          this.notifyPackAllies(String((target as any).id), st, proto, {
            snapAllies: true,
            forceRoomId: nextRoomId,
            sessions,
            tickNow,
          });
        }
      }

      // Move the leader exactly one room step.
      this.moveNpcToRoom(st, npcId, nextRoomId);
      (st as any).trainMovedAt = tickNow;

      // Mark pursuit as active.
      if (typeof (st as any).trainChaseStartTs !== "number") (st as any).trainChaseStartTs = tickNow;
      return true;
    }

    const npcX = typeof npcEntity.x === "number" ? npcEntity.x : 0;
    const npcY = typeof npcEntity.y === "number" ? npcEntity.y : 0;
    const npcZ = typeof npcEntity.z === "number" ? npcEntity.z : 0;

    const tgtX = typeof target.x === "number" ? target.x : 0;
    const tgtY = typeof target.y === "number" ? target.y : 0;
    const tgtZ = typeof target.z === "number" ? target.z : 0;

    const dx = tgtX - npcX;
    const dz = tgtZ - npcZ;
    const dist = Math.sqrt(dx * dx + dz * dz);

    // If we're already close enough, nothing to do.
    const MELEE_RANGE = 4;
    if (dist <= MELEE_RANGE) return false;

    const spawnX = typeof (npcEntity as any).spawnX === "number" ? (npcEntity as any).spawnX : (typeof (st as any).spawnX === "number" ? (st as any).spawnX : npcX);
    const spawnY = typeof (npcEntity as any).spawnY === "number" ? (npcEntity as any).spawnY : (typeof (st as any).spawnY === "number" ? (st as any).spawnY : npcY);
    const spawnZ = typeof (npcEntity as any).spawnZ === "number" ? (npcEntity as any).spawnZ : (typeof (st as any).spawnZ === "number" ? (st as any).spawnZ : npcZ);

    // Ensure entity + runtime state share the same spawn coords (some test harnesses inspect one or the other).
    if (typeof (npcEntity as any).spawnX !== "number" && typeof (st as any).spawnX === "number") (npcEntity as any).spawnX = (st as any).spawnX;
    if (typeof (npcEntity as any).spawnY !== "number" && typeof (st as any).spawnY === "number") (npcEntity as any).spawnY = (st as any).spawnY;
    if (typeof (npcEntity as any).spawnZ !== "number" && typeof (st as any).spawnZ === "number") (npcEntity as any).spawnZ = (st as any).spawnZ;
    if (typeof (st as any).spawnX !== "number" && typeof (npcEntity as any).spawnX === "number") (st as any).spawnX = (npcEntity as any).spawnX;
    if (typeof (st as any).spawnY !== "number" && typeof (npcEntity as any).spawnY === "number") (st as any).spawnY = (npcEntity as any).spawnY;
    if (typeof (st as any).spawnZ !== "number" && typeof (npcEntity as any).spawnZ === "number") (st as any).spawnZ = (npcEntity as any).spawnZ;

    const sdx = npcX - spawnX;
    const sdz = npcZ - spawnZ;
    const distFromSpawn = Math.sqrt(sdx * sdx + sdz * sdz);

    // Optional pursue timeout: if the NPC has been chasing too long, disengage.
    const chaseStart = typeof (npcEntity as any).trainPursueStartAt === "number"
      ? Number((npcEntity as any).trainPursueStartAt)
      : 0;

    if (!chaseStart) (npcEntity as any).trainPursueStartAt = tickNow;

    if (cfg.pursueTimeoutMs > 0) {
      const started = chaseStart || tickNow;
      if (tickNow - started > cfg.pursueTimeoutMs) {
        (st as any).trainMovedAt = tickNow;
        return this.trainDisengage(npcId, st, npcEntity, roomId, spawnX, spawnY, spawnZ, cfg);
      }
    }

    // Hard leash: disengage if too far from spawn.
    // Use >= to avoid "sticking" exactly on the leash boundary if coordinates are quantized.
    if (cfg.hardLeash > 0 && distFromSpawn >= cfg.hardLeash) {
      (st as any).trainMovedAt = tickNow;
      return this.trainDisengage(npcId, st, npcEntity, roomId, spawnX, spawnY, spawnZ, cfg);
    }

    // Soft leash factor: slow down as we approach hard leash.
    let factor = 1;
    if (cfg.softLeash > 0 && cfg.hardLeash > cfg.softLeash && distFromSpawn > cfg.softLeash) {
      const t = (distFromSpawn - cfg.softLeash) / (cfg.hardLeash - cfg.softLeash);
      factor = Math.max(0.15, 1 - t);
    }

    const step = cfg.step * factor;
    if (step <= 0) return false;

    // Move toward target (XZ plane). Keep Y stable for now.
    const inv = dist > 0 ? 1 / dist : 0;
    const nx = npcX + dx * inv * step;
    const nz = npcZ + dz * inv * step;

    this.entities.setPosition(npcId, nx, npcY, nz);
    (st as any).trainMovedAt = tickNow;

    // Mark that train chase ran for debugging/tests.
    (npcEntity as any).trainChasing = true;
    return true;
  }

  private trainDisengage(
    npcId: string,
    st: NpcRuntimeState,
    npcEntity: any,
    roomId: string,
    spawnX: number,
    spawnY: number,
    spawnZ: number,
    cfg: TrainConfig,
  ): boolean {
    // Clear threat + combat flags
    this.clearThreat(npcId);
    (st as any).inCombat = false;
    (npcEntity as any).inCombat = false;
    (npcEntity as any).trainChasing = false;
    (npcEntity as any).trainPursueStartAt = 0;

    
    // If configured, drift home instead of instant snapback. This preserves classic train feel
    // while still clearing threat and removing the NPC from active combat.
    if (cfg.returnMode === "drift") {
      (st as any).trainReturning = true;
      (npcEntity as any).trainReturning = true;
      (npcEntity as any).trainReturnTargetRoomId = (st as any).spawnRoomId ?? roomId;
      // Keep current position; return movement is handled by the Train pre-hook in updateAll().
      return true;
    }

// Snap back to spawn coords
    this.entities.setPosition(npcId, spawnX, spawnY, spawnZ);
    // Also update the passed entity reference and the canonical entity object,
    // since some harnesses/tests keep direct references.
    (npcEntity as any).x = spawnX;
    (npcEntity as any).y = spawnY;
    (npcEntity as any).z = spawnZ;
    const canonical = this.entities.get(npcId) as any;
    if (canonical) { canonical.x = spawnX; canonical.y = spawnY; canonical.z = spawnZ; }
    (st as any).x = spawnX;
    (st as any).y = spawnY;
    (st as any).z = spawnZ;
    (st as any).trainMovedAt = this._tickNow || (st as any).trainMovedAt || 0;

    // Keep runtime state in sync
    st.roomId = roomId;

    return true;
  }

  // Threat state is versioned/typed; never blast it to `{}`.
  private clearThreat(npcId: string): void {
    this.npcThreat.set(npcId, {
      lastAttackerEntityId: undefined,
      lastAggroAt: 0,
      threatByEntityId: {},
      forcedTargetEntityId: undefined,
      forcedUntil: 0,
      lastTauntAt: 0,
    });
  }

/**
   * Debug helper: return the raw threat state for an NPC entity id.
   *
   * Intentionally read-only; callers must not mutate the returned object.
   * Returns undefined if the entity has no threat state (not an NPC, despawned, etc.).
   *
   * Used by debug commands (e.g. debug_threat).
   */
  getThreatState(entityId: string) {
    const id = String(entityId ?? "").trim();
    if (!id) return undefined;
    return this.npcThreat.get(id);
  }

  /**
   * Debug-only: clear an NPC's threat table.
   * Returns false if the entity is not an NPC runtime state.
   */
  debugClearThreat(entityId: string): boolean {
    const id = String(entityId ?? "").trim();
    if (!id) return false;
    if (!this.npcsByEntityId.has(id)) return false;
    this.npcThreat.set(id, {
      lastAttackerEntityId: undefined,
      lastAggroAt: undefined,
      threatByEntityId: {},
      forcedTargetEntityId: undefined,
      forcedUntil: undefined,
      lastTauntAt: undefined,
    });
    return true;
  }

  /**
   * Debug-only: set (or add) a specific threat value for a target entity.
   */
  debugSetThreatValue(
    npcEntityId: string,
    targetEntityId: string,
    value: number,
    opts?: { add?: boolean; now?: number },
  ): boolean {
    const npcId = String(npcEntityId ?? "").trim();
    const targetId = String(targetEntityId ?? "").trim();
    if (!npcId || !targetId) return false;
    if (!this.npcsByEntityId.has(npcId)) return false;

    const now = opts?.now ?? Date.now();
    const current = this.npcThreat.get(npcId) ?? {};
    const table = { ...(current.threatByEntityId ?? {}) } as Record<string, number>;
    const base = typeof table[targetId] === "number" ? table[targetId] : 0;
    const nextVal = Math.max(0, (opts?.add ? base + value : value));
    table[targetId] = nextVal;

    this.npcThreat.set(npcId, {
      ...current,
      lastAggroAt: now,
      lastAttackerEntityId: current.lastAttackerEntityId ?? targetId,
      threatByEntityId: table,
    });
    return true;
  }

  /**
   * Debug-only: force an NPC's target for a duration (ms).
   */
  debugForceTarget(
    npcEntityId: string,
    targetEntityId: string,
    durationMs: number,
    opts?: { now?: number },
  ): boolean {
    const npcId = String(npcEntityId ?? "").trim();
    const targetId = String(targetEntityId ?? "").trim();
    if (!npcId || !targetId) return false;
    if (!this.npcsByEntityId.has(npcId)) return false;

    const now = opts?.now ?? Date.now();
    const dur = Math.max(0, Math.floor(durationMs));
    const current = this.npcThreat.get(npcId) ?? {};
    this.npcThreat.set(npcId, {
      ...current,
      forcedTargetEntityId: targetId,
      forcedUntil: now + dur,
    });
    return true;
  }

}