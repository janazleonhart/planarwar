// worldcore/npc/NpcManager.ts

/**
 * Owns runtime NPC state and threat tables, bridges EntityManager ↔ AI brains,
 * and coordinates guard/pack help plus crime tagging. Driven by TickEngine and
 * constructed via WorldServices.
 */

import { EntityManager } from "../core/EntityManager";
import { SessionManager } from "../core/SessionManager";
import { Logger } from "../utils/logger";
import type { Entity } from "../shared/Entity";

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
import { clearAllStatusEffectsFromEntity, getActiveStatusEffectsForEntity } from "../combat/StatusEffects";
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
};

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
  };
}


// Prevent taunt spam-lock; during this window, new taunts from OTHER entities are ignored.
const PW_TAUNT_IMMUNITY_MS = Math.max(0, Math.floor(envNumber("PW_TAUNT_IMMUNITY_MS", 0)));


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

  private readonly brain = new LocalSimpleAggroBrain();

  // Optional services used for the canonical death pipeline (XP/loot/respawn).
  // Attached by WorldServices after construction.
  private deathServices?: {
    rooms?: any;
    characters?: any;
    items?: any;
    mail?: any;
  };

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



  private isGuardProtectedRoom(proto?: NpcPrototype | null): boolean {
    const tags = proto?.tags ?? [];

    return (
      tags.includes("town") ||
      tags.includes("protected_town") ||
      tags.includes("guard") ||
      proto?.guardProfile !== undefined
    );
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
    attacker?: { character?: CharacterState; entityId?: string },
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

    const newHp = Math.max(0, st.hp - Math.max(0, amount));
    st.hp = newHp;
    st.alive = newHp > 0;
    e.hp = newHp;
    e.alive = newHp > 0;

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

    // Best-effort threat attribution.
    if (attackerEntityId) {
      try {
        this.recordDamage(npcEntityId, attackerEntityId);
      } catch {
        // ignore
      }
    }

    // Apply raw damage.
    const newHp = this.applyDamage(
      npcEntityId,
      amount,
      attackerEntityId ? { entityId: attackerEntityId } : undefined,
    );

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

  private markPackHelp(npcId: string, offenderId: string): void {
    let set = this.packHelpCalled.get(npcId);
    if (!set) {
      set = new Set();
      this.packHelpCalled.set(npcId, set);
    }
    set.add(offenderId);
  }

  private hasMarkedPackHelp(npcId: string, offenderId: string): boolean {
    return this.packHelpCalled.get(npcId)?.has(offenderId) ?? false;
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
    if (!proto.groupId || !proto.canCallHelp) return;

    const attacker = this.entities.get(attackerEntityId);
    const targetRoomId = opts.forceRoomId ?? attacker?.roomId ?? st.roomId;

    const tickNow = (opts as any).tickNow ?? this._tickNow ?? 0;

    const considerRooms = new Set<string>([st.roomId, targetRoomId]);

    for (const room of considerRooms) {
      const allies = this.listNpcsInRoom(room).filter((ally) => {
        if (ally.entityId === st.entityId) return false;
        if (this.hasMarkedPackHelp(ally.entityId, attackerEntityId)) return false;

        const allyProto =
          getNpcPrototype(ally.templateId) ??
          getNpcPrototype(ally.protoId) ??
          DEFAULT_NPC_PROTOTYPES[ally.templateId] ??
          DEFAULT_NPC_PROTOTYPES[ally.protoId];

        return allyProto?.groupId === proto.groupId;
      });

      for (const ally of allies) {
        const threat = updateThreatFromDamage(
          this.npcThreat.get(ally.entityId),
          attackerEntityId,
        );
        this.npcThreat.set(ally.entityId, threat);

        ally.lastAggroAt = threat.lastAggroAt;
        ally.lastAttackerEntityId = threat.lastAttackerEntityId;

        this.markPackHelp(ally.entityId, attackerEntityId);

        if (opts.snapAllies && targetRoomId) {
          // Do not move an NPC twice in the same tick (prevents leader getting shoved forward by ally-assist).
          if (tickNow && (ally as any).trainMovedAt === tickNow) {
            continue;
          }
          this.moveNpcToRoom(ally, ally.entityId, targetRoomId);
          (ally as any).trainMovedAt = tickNow;
        }
      }
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

    const threatState = updateThreatFromDamage(
      this.npcThreat.get(spawned.entityId),
      attackerEntityId,
    );
    this.npcThreat.set(spawned.entityId, threatState);
    spawned.lastAggroAt = threatState.lastAggroAt;
    spawned.lastAttackerEntityId = threatState.lastAttackerEntityId;

    this.notifyPackAllies(attackerEntityId, spawned, proto, {
      snapAllies: true,
      forceRoomId: attackerRoomId,
      sessions,
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

      const threat0 = this.npcThreat.get(entityId);
      const now = this._tickNow || Date.now();

      // v1.4: deterministic threat decay in tick loop (so old grudges fade even without new hits).
      const threat = decayThreat(threat0, { now });
      if (threat && threat !== threat0) {
        this.npcThreat.set(entityId, threat);
      }

      // Build perception
      const playersInRoom: PerceivedPlayer[] = [];
      let topThreatId: string | undefined;
      try {
        const ents = this.entities.getEntitiesInRoom(roomId) as any[];

        // Resolve current target with visibility rules (stealth/out-of-room/dead).
        const byId = new Map<string, any>();

        const trainCfg = readTrainConfig();
        for (const e of ents) {
          if (e?.id) byId.set(String(e.id), e);
        }

        const sel = selectThreatTarget(threat, now, (id) => {
          let e = byId.get(String(id));
          if (!e && trainCfg.enabled && trainCfg.roomsEnabled) {
            e = this.entities.get(String(id));
          }
          if (!e) return { ok: false, reason: "missing" };
          if (e.alive === false) return { ok: false, reason: "dead" };
          if (typeof e.hp === "number" && e.hp <= 0) return { ok: false, reason: "dead" };

          const t = String(e.type ?? "");
          if (t === "player" || t === "character") {
            const active = getActiveStatusEffectsForEntity(e as any, now);
            if (active.some((se: any) => Array.isArray(se?.tags) && se.tags.includes("stealth"))) {
              return { ok: false, reason: "stealth" };
            }
          }
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
        hostile,
        currentTargetId: topThreatId,
        playersInRoom,
        sinceLastDecisionMs: deltaMs,
        lastAggroAt: threat?.lastAggroAt,
        lastAttackerId: threat?.lastAttackerEntityId,
      };


      // Train System pre-hook: chase even when the target is not in playersInRoom (cross-room),
      // and before any brain decision. This is required for room-tile pursuit.
      const cfg = readTrainConfig();
      if (cfg.enabled && topThreatId) {
        const targetEntity = this.entities.get(String(topThreatId));
        if (targetEntity && targetEntity.alive !== false && !(typeof targetEntity.hp === "number" && targetEntity.hp <= 0)) {
          const didChase = this.maybeTrainChase({
            npcId: entityId,
            st,
            npcEntity,
            targetEntity,
            roomId,
            now: this._tickNow,
            cfg,
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
      if (cfg.assistEnabled && cfg.assistSnapAllies) {
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
        return this.trainDisengageAndSnapback(npcId, st, npcEntity, roomId, spawnX, spawnY, spawnZ);
      }
    }

    // Hard leash: disengage if too far from spawn.
    // Use >= to avoid "sticking" exactly on the leash boundary if coordinates are quantized.
    if (cfg.hardLeash > 0 && distFromSpawn >= cfg.hardLeash) {
      (st as any).trainMovedAt = tickNow;
      return this.trainDisengageAndSnapback(npcId, st, npcEntity, roomId, spawnX, spawnY, spawnZ);
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

  private trainDisengageAndSnapback(
    npcId: string,
    st: NpcRuntimeState,
    npcEntity: any,
    roomId: string,
    spawnX: number,
    spawnY: number,
    spawnZ: number,
  ): boolean {
    // Clear threat + combat flags
    this.clearThreat(npcId);
    (st as any).inCombat = false;
    (npcEntity as any).inCombat = false;
    (npcEntity as any).trainChasing = false;
    (npcEntity as any).trainPursueStartAt = 0;

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
