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
  type NpcThreatState,
  updateThreatFromDamage,
} from "./NpcThreat";

import { recordNpcCrimeAgainst, isProtectedNpc } from "./NpcCrime";
import { isServiceProtectedNpcProto } from "../combat/ServiceProtection";

import {
  markInCombat,
  applySimpleDamageToPlayer,
  computeNpcMeleeDamage,
} from "../combat/entityCombat";

import { getCombatRoleForClass } from "../classes/ClassDefinitions";
import type { CharacterState } from "../characters/CharacterTypes";

const log = Logger.scope("NPC");

/**
 * Server-side NPC manager.
 *
 * - Owns runtime NPC state (hp, room, etc.)
 * - Bridges EntityManager ↔ AI brain ↔ sessions/chat.
 */
export class NpcManager {
  private npcsByEntityId = new Map<string, NpcRuntimeState>();
  private npcsByRoom = new Map<string, Set<string>>();
  private npcThreat = new Map<string, NpcThreatState>();
  private guardHelpCalled = new Map<string, Set<string>>();
  private packHelpCalled = new Map<string, Set<string>>();

  private readonly brain = new LocalSimpleAggroBrain();

  constructor(
    private readonly entities: EntityManager,
    private readonly sessions?: SessionManager,
  ) {}

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

    const newHp = Math.max(0, st.hp - Math.max(0, amount));
    st.hp = newHp;
    st.alive = newHp > 0;
    e.hp = newHp;
    e.alive = newHp > 0;

    if (attacker?.character && proto) {
      if (isProtectedNpc(proto)) {
        recordNpcCrimeAgainst(st, attacker.character, {
          lethal: newHp <= 0,
          proto,
        });
      }

      if (proto.canCallHelp && proto.groupId && attacker.entityId) {
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

  recordDamage(targetEntityId: string, attackerEntityId: string): void {
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

    const threat = updateThreatFromDamage(
      this.npcThreat.get(targetEntityId),
      attackerEntityId,
    );
    this.npcThreat.set(targetEntityId, threat);

    st.lastAggroAt = threat.lastAggroAt;
    st.lastAttackerEntityId = threat.lastAttackerEntityId;

    if (proto?.canCallHelp && proto.groupId) {
      this.notifyPackAllies(attackerEntityId, st, proto, {
        snapAllies: false,
      });
    }
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
    opts: { snapAllies: boolean; forceRoomId?: string; sessions?: SessionManager },
  ): void {
    if (!proto.groupId || !proto.canCallHelp) return;

    const attacker = this.entities.get(attackerEntityId);
    const targetRoomId = opts.forceRoomId ?? attacker?.roomId ?? st.roomId;

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
          this.moveNpcToRoom(ally, ally.entityId, targetRoomId);
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
      sessions: sessionManager,
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

      const threat = this.npcThreat.get(entityId);

      // Build perception
      const playersInRoom: PerceivedPlayer[] = [];
      try {
        const ents = this.entities.getEntitiesInRoom(roomId) as any[];

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

        if (threat?.lastAttackerEntityId) {
          playersInRoom.sort((a, b) => {
            if (a.entityId === threat.lastAttackerEntityId) return -1;
            if (b.entityId === threat.lastAttackerEntityId) return 1;
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
        currentTargetId: undefined,
        playersInRoom,
        sinceLastDecisionMs: deltaMs,
        lastAggroAt: threat?.lastAggroAt,
        lastAttackerId: threat?.lastAttackerEntityId,
      };

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

    const now = Date.now();

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
}
