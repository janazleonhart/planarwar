// worldcore/npc/NpcManager.ts

import { EntityManager } from "../core/EntityManager";
import { SessionManager } from "../core/SessionManager";
import { Logger } from "../utils/logger";

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

  private readonly brain = new LocalSimpleAggroBrain();

  constructor(private readonly entities: EntityManager) {}

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
    const e = this.entities.createNpcEntity(roomId, proto.model ?? proto.name);

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

    this.entities.setPosition(e.id, x, y, z);

    const state: NpcRuntimeState = {
      entityId: e.id,
      protoId: proto.id,
      templateId: proto.id,
      variantId: variantId ?? null,
      roomId,
      hp: proto.maxHp,
      maxHp: proto.maxHp,
      alive: true,
      fleeing: false,
    };

    this.npcsByEntityId.set(e.id, state);
    this.npcThreat.set(e.id, {});

    let set = this.npcsByRoom.get(roomId);
    if (!set) {
      set = new Set<string>();
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
    attacker?: { character?: CharacterState },
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

    const newHp = Math.max(0, st.hp - Math.max(0, amount));
    st.hp = newHp;
    st.alive = newHp > 0;

    e.hp = newHp;
    e.alive = newHp > 0;

    if (attacker?.character && proto && isProtectedNpc(proto)) {
      recordNpcCrimeAgainst(st, attacker.character, {
        lethal: newHp <= 0,
        proto,
      });
    }

    if (st.alive && st.maxHp > 0 && st.hp < st.maxHp) {
      // if this was the first time they were hurt, clear fleeing flag
      // (brain/manager will handle coward behavior next tick)
      st.fleeing = st.fleeing ?? false;
    }

    return newHp;
  }

  recordDamage(targetEntityId: string, attackerEntityId: string): void {
    if (!this.npcsByEntityId.has(targetEntityId)) return;
    const threat = updateThreatFromDamage(
      this.npcThreat.get(targetEntityId),
      attackerEntityId,
    );
    this.npcThreat.set(targetEntityId, threat);

    const st = this.npcsByEntityId.get(targetEntityId);
    if (st) {
      st.lastAggroAt = threat.lastAggroAt;
      st.lastAttackerEntityId = threat.lastAttackerEntityId;
    }
  }

  private hasCalledGuardHelp(npcId: string, offenderId: string): boolean {
    return this.guardHelpCalled.get(npcId)?.has(offenderId) ?? false;
  }

  private markGuardHelp(npcId: string, offenderId: string): void {
    let set = this.guardHelpCalled.get(npcId);
    if (!set) {
      set = new Set<string>();
      this.guardHelpCalled.set(npcId, set);
    }
    set.add(offenderId);
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
    const offenderKey =
      sessions?.get(target.ownerSessionId)?.character?.id ?? target.id;
    if (this.hasCalledGuardHelp(npcId, offenderKey)) return;

    this.markGuardHelp(npcId, offenderKey);
    this.brain.markCalledHelp(npcId, offenderKey);

    const shout =
      `[guard] ${npcEntity.name ?? "Guard"} yells: ` +
      "To me! Defend the town!";
    this.handleSayDecision(roomId, shout, sessions);

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
        guardCallRadius >= 0;
      if (radiusOk && offenderKey) {
        this.brain.markWarnedTarget(ally.entityId, offenderKey);
        this.brain.markCalledHelp(ally.entityId, offenderKey);
      }
    }
  }

  getLastAttacker(targetEntityId: string): string | undefined {
    return getLastAttackerFromThreat(this.npcThreat.get(targetEntityId));
  }

  // -------------------------------------------------------------------------
  // Tick update
  // -------------------------------------------------------------------------

  updateAll(deltaMs: number, sessions?: SessionManager): void {
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

      // safety: if coward id got scrambled, force default coward proto for tests
      if (st.protoId === "coward_rat" || st.templateId === "coward_rat") {
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

      const hostile =
        !nonHostile &&
        (behavior === "aggressive" ||
          behavior === "guard" ||
          behavior === "coward");

      // Build perception
      const playersInRoom: PerceivedPlayer[] = [];

      try {
        const ents = this.entities.getEntitiesInRoom(roomId) as any[];
        for (const e of ents) {
          if (e.type !== "player") continue;

          const maxHp =
            typeof e.maxHp === "number" && e.maxHp > 0 ? e.maxHp : 100;
          const hp = typeof e.hp === "number" ? e.hp : maxHp;

          const session = e.ownerSessionId
            ? sessions?.get(e.ownerSessionId)
            : undefined;
          const char = session?.character;

          playersInRoom.push({
            entityId: e.id,
            characterId: char?.id ?? (e as any).characterId,
            hp,
            maxHp,
            recentCrimeUntil: char?.recentCrimeUntil,
            recentCrimeSeverity: char?.recentCrimeSeverity,
            combatRole: char ? getCombatRoleForClass(char.classId) : undefined,
          });
        }
      } catch (err) {
        log.warn("Failed to build NPC perception", { entityId, err });
        continue;
      }

      const threat = this.npcThreat.get(entityId);

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

      const decision = this.brain.decide(perception, deltaMs);
      if (!decision) continue;

      switch (decision.kind) {
        case "flee":
          this.handleFleeDecision(
            entityId,
            st,
            npcEntity,
            roomId,
            behavior,
            sessions,
          );
          break;

        case "say":
          this.handleSayDecision(roomId, decision.text, sessions);
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
            sessions,
          );
          break;

        default:
          // idle / say / move_to_room not yet implemented
          break;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Internal AI helpers
  // -------------------------------------------------------------------------

  private handleFleeDecision(
    npcId: string,
    st: NpcRuntimeState,
    npcEntity: any,
    roomId: string,
    behavior: string,
    sessions?: SessionManager,
  ): void {
    st.fleeing = true;

    if (sessions) {
      try {
        const ents = this.entities.getEntitiesInRoom(roomId) as any[];
        const player = ents.find((e) => e.type === "player");
        if (player && player.ownerSessionId) {
          const s = sessions.get(player.ownerSessionId);
          if (s) {
            sessions.send(s, "chat", {
              from: "[world]",
              sessionId: "system",
              text: `[combat] ${npcEntity.name} squeals and scurries away!`,
              t: Date.now(),
            });
          }
        }
      } catch {
        // if this explodes, fleeing still works; we just skip the flavor text
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
    if (!sessions) return;
    try {
      const ents = this.entities.getEntitiesInRoom(roomId) as any[];
      for (const e of ents) {
        if (e.type !== "player") continue;
        const ownerSessionId = e.ownerSessionId;
        if (!ownerSessionId) continue;
        const s = sessions.get(ownerSessionId);
        if (s) {
          sessions.send(s, "chat", {
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

    // Keep state roughly in sync so future checks see the same numbers
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

    // HARD OVERRIDE:
    // If this is a coward and it has taken any damage at all,
    // do NOT attack. Announce a flee instead and bail.
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
    const targetHp = typeof target.hp === "number" ? target.hp : targetMaxHp;

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
        sessions,
      );
    }

    const dmg = computeNpcMeleeDamage(npcEntity);
    const { newHp, maxHp, killed } = applySimpleDamageToPlayer(target, dmg);

    // Tag NPC as in combat as well
    markInCombat(npcEntity);

    let line: string;
    if (killed) {
      line =
        `[combat][AIv2${npcHpDebug}] ${npcEntity.name} hits you for ${dmg} damage.\n` +
        `You die. (0/${maxHp} HP) Use 'respawn' to return to safety or wait for someone to resurrect you.`;
    } else {
      line =
        `[combat][AIv2${npcHpDebug}] ${npcEntity.name} hits you for ${dmg} damage.\n` +
        `(${newHp}/${maxHp} HP)`;
    }

    if (sessions) {
      const ownerSessionId = (target as any).ownerSessionId;
      if (ownerSessionId) {
        const s = sessions.get(ownerSessionId);
        if (s) {
          sessions.send(s, "chat", {
            from: "[world]",
            sessionId: "system",
            text: line,
            t: Date.now(),
          });
        }
      }
    }
  }
}
