// worldcore/mud/commands/world/walktoCommand.ts
//
// Auto-walk helper.
// - walkto <handle|name|service> [--radius N] [--max N] [--delay ms]
// - walkto --risk            (show warning / disable if already enabled)
// - walkto --risk yes        (enable risk mode; persists on character)
// - walkto --risk status     (show risk mode + cooldown + cowardice stacks)
// - walkto --coward          (disable risk mode + clear cowardice debuff)
//
// Services: bank, gbank, mail, ah, vendor
//
// Risk mode:
// - Allows auto-walk to continue even if combat starts mid-walk.
// - Applies/extends a stacking "cowardice" debuff state (penalties wired later).
// - Requires explicit confirmation ("--risk yes") to enable.
// - Disabling is always allowed, but re-enabling is blocked by a cooldown.
//

import type { MudContext } from "../../MudContext";
import type { CharacterState } from "../../../characters/CharacterTypes";
import { moveCharacterAndSync } from "../../../movement/moveOps";
import { parseMoveDir } from "../../../movement/MovementCommands";

type ServiceName = "bank" | "guildbank" | "vendor" | "auction" | "mail";

type MudInput = {
  cmd: string;
  args: any;
  parts: any;
  world?: any;
};

type WalktoFlags = {
  // persistent toggles
  walktoRiskEnabled?: boolean;
  walktoRiskCooldownUntilMs?: number;

  // penalty state (stacking debuff placeholder)
  walktoCowardiceStacks?: number;
  walktoCowardiceUntilMs?: number;
  walktoCowardiceLastAppliedAtMs?: number;
};

function envInt(name: string, fallback: number): number {
  const raw = (process.env[name] ?? "").toString().trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

function envBool(name: string, fallback = false): boolean {
  const raw = (process.env[name] ?? "").toString().trim().toLowerCase();
  if (!raw) return fallback;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toArgArray(v: any): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (typeof v === "string") return v.trim().length ? v.trim().split(/\s+/) : [];
  // Some callers may pass { args: string[] }, so try that.
  if (v && typeof v === "object" && Array.isArray((v as any).args)) return (v as any).args.map(String);
  return [];
}

function norm(s: any): string {
  return String(s ?? "").trim().toLowerCase();
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function formatMs(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m <= 0) return `${s}s`;
  return `${m}m ${r}s`;
}

function getFlags(char: CharacterState): WalktoFlags {
  // Preferred home: char.progression.flags (common Planar War pattern)
  const anyChar: any = char as any;
  anyChar.progression ??= {};
  anyChar.progression.flags ??= {};
  return anyChar.progression.flags as WalktoFlags;
}

function getRoomId(ctx: MudContext, char: CharacterState): string | null {
  const roomId = (ctx.session as any)?.roomId;
  if (typeof roomId === "string" && roomId.length > 0) return roomId;

  const ent = (ctx.entities as any)?.getEntityByOwner?.(ctx.session.id) as any;
  const r = ent?.roomId;
  if (typeof r === "string" && r.length > 0) return r;

  const lastRegion = (char as any)?.lastRegionId;
  if (typeof lastRegion === "string" && lastRegion.length > 0) return lastRegion;

  return null;
}

function getPlayerXZ(ctx: MudContext, char: CharacterState): { x: number; z: number } {
  const ent = (ctx.entities as any)?.getEntityByOwner?.(ctx.session.id) as any;
  const x =
    (typeof ent?.x === "number" ? ent.x : undefined) ??
    (typeof (char as any)?.posX === "number" ? (char as any).posX : undefined) ??
    0;
  const z =
    (typeof ent?.z === "number" ? ent.z : undefined) ??
    (typeof (char as any)?.posZ === "number" ? (char as any).posZ : undefined) ??
    0;
  return { x, z };
}

function getEntitiesInRoom(ctx: MudContext, roomId: string): any[] {
  const ents = (ctx.entities as any)?.getEntitiesInRoom?.(roomId);
  return Array.isArray(ents) ? ents : [];
}

function normalizeHandleBase(name: string): string {
  const words = name
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .split(/\s+/)
    .filter(Boolean);
  return words[words.length - 1] ?? "entity";
}

function buildNearbyLikeTargets(ctx: MudContext, char: CharacterState, roomId: string) {
  const entities = getEntitiesInRoom(ctx, roomId);
  const self = (ctx.entities as any)?.getEntityByOwner?.(ctx.session.id) as any;
  const selfId = self?.id;

  const { x: originX, z: originZ } = getPlayerXZ(ctx, char);

  const others = (entities as any[]).filter((e) => e && e.id && e.id !== selfId);

  const withDist = others
    .map((e) => {
      const dx = (e.x ?? 0) - originX;
      const dz = (e.z ?? 0) - originZ;
      const dist = Math.sqrt(dx * dx + dz * dz);
      return { e, dist };
    })
    .sort((a, b) => {
      if (a.dist !== b.dist) return a.dist - b.dist;
      const an = String(a.e?.name ?? "").toLowerCase();
      const bn = String(b.e?.name ?? "").toLowerCase();
      if (an !== bn) return an.localeCompare(bn);
      return String(a.e?.id ?? "").localeCompare(String(b.e?.id ?? ""));
    });

  const shortCounts = new Map<string, number>();

  const targets = withDist.map(({ e, dist }) => {
    const hasSpawnPoint = typeof e?.spawnPointId === "number";
    const isPlayerLike = !!e?.ownerSessionId && !hasSpawnPoint;

    let kind: string;
    if (isPlayerLike) kind = "player";
    else if (e.type === "npc" || e.type === "mob") kind = "npc";
    else kind = e.type ?? "entity";

    const name = String(e.name ?? e.id);
    const base = normalizeHandleBase(name);
    const shortKey = `${kind}:${base}`;
    const n = (shortCounts.get(shortKey) ?? 0) + 1;
    shortCounts.set(shortKey, n);

    const hint = `${base}.${n}`;
    return { e, dist, kind, name, hint };
  });

  const byHint = new Map<string, any>();
  for (const t of targets) byHint.set(t.hint.toLowerCase(), t);

  return { targets, byHint };
}

function serviceRadius(service: ServiceName): number {
  const base = envInt("PW_SERVICE_RADIUS", 12);
  const per = envInt(`PW_SERVICE_RADIUS_${service.toUpperCase()}`, Number.NaN as any);
  return Number.isFinite(per) ? per : base;
}

function isServiceKeyword(s: string): ServiceName | null {
  const k = norm(s);
  if (k === "bank") return "bank";
  if (k === "gbank" || k === "guildbank") return "guildbank";
  if (k === "mail" || k === "mailbox") return "mail";
  if (k === "ah" || k === "auction" || k === "auctioneer") return "auction";
  if (k === "vendor" || k === "shop" || k === "merchant") return "vendor";
  return null;
}

function isServiceAnchorEntity(e: any, service: ServiceName): boolean {
  if (!e) return false;

  // exclude players
  const hasSpawnPoint = typeof e.spawnPointId === "number";
  const isPlayerLike = !!e.ownerSessionId && !hasSpawnPoint;
  if (isPlayerLike) return false;

  const t = norm(e.type);
  const tags = Array.isArray(e.tags) ? e.tags.map(norm) : [];
  const roles = Array.isArray(e.roles) ? e.roles.map(norm) : [];
  const svcKind = norm(e.serviceKind);

  const wantTag = service === "guildbank" ? "service_bank" : `service_${service}`;

  const typeMatches =
    (service === "mail" && (t === "mailbox" || t === "mail")) ||
    ((service === "bank" || service === "guildbank") && (t === "banker" || t === "bank")) ||
    (service === "auction" && (t === "auctioneer" || t === "auction")) ||
    (service === "vendor" && (t === "vendor" || t === "merchant"));

  const tagMatches =
    tags.includes(wantTag) ||
    (tags.includes("protected_service") && (tags.includes(wantTag) || svcKind === service));

  const roleMatches = roles.includes(wantTag) || roles.includes(service);

  const kindMatches = svcKind === service || (service === "guildbank" && svcKind === "bank");

  return !!(typeMatches || tagMatches || roleMatches || kindMatches);
}

function findNearestAnchor(ctx: MudContext, char: CharacterState, service: ServiceName) {
  const roomId = getRoomId(ctx, char);
  if (!roomId) return null;

  const { x: px, z: pz } = getPlayerXZ(ctx, char);
  const ents = getEntitiesInRoom(ctx, roomId);

  let best: { e: any; dist: number } | null = null;
  for (const e of ents) {
    if (!isServiceAnchorEntity(e, service)) continue;
    const ex = typeof e.x === "number" ? e.x : 0;
    const ez = typeof e.z === "number" ? e.z : 0;
    const dx = ex - px;
    const dz = ez - pz;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (!best || dist < best.dist) best = { e, dist };
  }

  return best?.e ?? null;
}

function distanceXZ(ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  return Math.sqrt(dx * dx + dz * dz);
}

function stepDirTowards(dx: number, dz: number, preferX: boolean): "n" | "s" | "e" | "w" {
  const ax = Math.abs(dx);
  const az = Math.abs(dz);

  if (preferX ? ax >= az : az > ax) {
    return dx > 0 ? "e" : "w";
  }
  return dz > 0 ? "s" : "n";
}

/**
 * Best-effort combat detection without tightly coupling to CombatSystem internals.
 * We check multiple common signals; missing signals => assume not in combat.
 */
function isInCombat(ctx: MudContext, char: CharacterState): boolean {
  const ent = (ctx.entities as any)?.getEntityByOwner?.(ctx.session.id) as any;
  const combat: any = (ctx as any).combat;

  // CharacterState flags (if present)
  const s = (char as any)?.status;
  if (typeof s === "string" && s.toLowerCase().includes("combat")) return true;
  if ((char as any)?.inCombat === true) return true;

  // Entity flags (if present)
  if (ent?.inCombat === true) return true;
  if (typeof ent?.combatState === "string" && norm(ent.combatState).includes("combat")) return true;

  // Combat system API (if present)
  if (combat) {
    if (typeof combat.isInCombat === "function") {
      try {
        const id = ent?.id ?? (ctx.session as any)?.id;
        return !!combat.isInCombat(id);
      } catch {
        // ignore
      }
    }
    if (typeof combat.hasAggro === "function") {
      try {
        const id = ent?.id ?? (ctx.session as any)?.id;
        return !!combat.hasAggro(id);
      } catch {
        // ignore
      }
    }
  }

  return false;
}

type WalkOptions = {
  radiusOverride?: number;
  maxStepsOverride?: number;
  stepDelayOverride?: number;

  // mode controls
  riskArg?: string | null; // only set if --risk was present
  coward?: boolean;

  // request behavior
  keep: string[]; // remaining tokens that form the target
};

function parseOptions(argv: string[]): WalkOptions {
  let radiusOverride: number | undefined;
  let maxStepsOverride: number | undefined;
  let stepDelayOverride: number | undefined;

  let riskArg: string | null | undefined = undefined;
  let coward = false;

  const keep: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];

    if (a === "--r" || a === "--radius") {
      const v = Number(argv[i + 1]);
      if (Number.isFinite(v)) radiusOverride = v;
      i++;
      continue;
    }

    if (a === "--max") {
      const v = Number(argv[i + 1]);
      if (Number.isFinite(v)) maxStepsOverride = Math.trunc(v);
      i++;
      continue;
    }

    if (a === "--delay") {
      const v = Number(argv[i + 1]);
      if (Number.isFinite(v)) stepDelayOverride = Math.trunc(v);
      i++;
      continue;
    }

    if (a === "--coward") {
      coward = true;
      continue;
    }

    if (a === "--risk") {
      // optional inline value: "--risk yes" / "--risk status"
      const nxt = argv[i + 1];
      if (nxt && !nxt.startsWith("--")) {
        riskArg = String(nxt);
        i++;
      } else {
        riskArg = null;
      }
      continue;
    }

    keep.push(a);
  }

  return { radiusOverride, maxStepsOverride, stepDelayOverride, riskArg, coward, keep };
}

function riskEnabled(char: CharacterState): boolean {
  const flags = getFlags(char);
  return !!flags.walktoRiskEnabled;
}

function riskCooldownRemainingMs(char: CharacterState): number {
  const flags = getFlags(char);
  const until = flags.walktoRiskCooldownUntilMs ?? 0;
  return Math.max(0, until - Date.now());
}

function setRiskEnabled(char: CharacterState, enabled: boolean, cooldownMs: number) {
  const flags = getFlags(char);
  flags.walktoRiskEnabled = enabled;

  // When we disable, we set the next time enabling is allowed.
  // Goal: players can always turn it OFF, but can't spam ON/OFF to abuse movement.
  if (!enabled) {
    flags.walktoRiskCooldownUntilMs = Date.now() + cooldownMs;
  }
}

function clearCowardice(char: CharacterState) {
  const flags = getFlags(char);
  delete flags.walktoCowardiceStacks;
  delete flags.walktoCowardiceUntilMs;
  delete flags.walktoCowardiceLastAppliedAtMs;
}

function applyCowardiceStack(char: CharacterState): { stacks: number; remainingMs: number } {
  const flags = getFlags(char);

  const maxStacks = clamp(envInt("PW_WALKTO_COWARDICE_MAX_STACKS", 10), 1, 50);
  const baseMs = clamp(envInt("PW_WALKTO_COWARDICE_BASE_MS", 180_000), 30_000, 3_600_000); // default 3m
  const addMs = clamp(envInt("PW_WALKTO_COWARDICE_ADD_MS", 60_000), 0, 3_600_000); // default +1m per stack

  const now = Date.now();

  // prevent stack spam within the same walk tick loop
  const lastApplied = flags.walktoCowardiceLastAppliedAtMs ?? 0;
  const minInterval = clamp(envInt("PW_WALKTO_COWARDICE_MIN_INTERVAL_MS", 15_000), 0, 600_000);
  if (now - lastApplied < minInterval) {
    const until = flags.walktoCowardiceUntilMs ?? now;
    return { stacks: flags.walktoCowardiceStacks ?? 1, remainingMs: Math.max(0, until - now) };
  }

  const curStacks = flags.walktoCowardiceStacks ?? 0;
  const stacks = clamp(curStacks + 1, 1, maxStacks);

  const until = Math.max(flags.walktoCowardiceUntilMs ?? 0, now + baseMs) + addMs;
  flags.walktoCowardiceStacks = stacks;
  flags.walktoCowardiceUntilMs = until;
  flags.walktoCowardiceLastAppliedAtMs = now;

  return { stacks, remainingMs: Math.max(0, until - now) };
}

function riskWarning(): string {
  return [
    "[walk] RISK MODE WARNING:",
    "- Auto-walk will NOT stop when combat starts.",
    "- You can die. A lot.",
    "- While risking, you will accumulate a stacking 'cowardice' debuff (penalties wired later).",
    "- Intended use: convenience while accepting danger; not a free bypass of hostile territory.",
    "",
    "To enable:  walkto --risk yes",
    "To disable: walkto --coward  (or walkto --risk when already enabled)",
  ].join("\n");
}

function riskStatusLine(char: CharacterState): string {
  const flags = getFlags(char);
  const enabled = !!flags.walktoRiskEnabled;
  const cd = riskCooldownRemainingMs(char);

  const stacks = flags.walktoCowardiceStacks ?? 0;
  const until = flags.walktoCowardiceUntilMs ?? 0;
  const rem = Math.max(0, until - Date.now());

  const bits: string[] = [];
  bits.push(`[walk] Risk mode: ${enabled ? "ENABLED" : "disabled"}`);
  if (!enabled && cd > 0) bits.push(`re-enable cooldown: ${formatMs(cd)}`);

  if (stacks > 0 && rem > 0) bits.push(`cowardice: ${stacks} stack(s), expires in ${formatMs(rem)}`);
  else if (stacks > 0) bits.push(`cowardice: ${stacks} stack(s) (expired)`);
  return bits.join(" | ");
}

function resolveTarget(
  ctx: MudContext,
  char: CharacterState,
  roomId: string,
  targetRaw: string
): { target: any; desiredRadius: number; targetLabel: string } | null {
  let desiredRadius = 3; // default for generic entities
  const asService = isServiceKeyword(targetRaw);

  if (asService) {
    const target = findNearestAnchor(ctx, char, asService);
    desiredRadius = serviceRadius(asService);
    if (!target) return null;
    return { target, desiredRadius, targetLabel: asService };
  }

  // handle like rat.1 / mailbox.1 / towntest00.1
  const { targets, byHint } = buildNearbyLikeTargets(ctx, char, roomId);
  const key = targetRaw.toLowerCase().trim();

  let target: any | null = null;

  if (/^\d+$/.test(key)) {
    const idx = Math.max(1, parseInt(key, 10)) - 1;
    target = targets[idx]?.e ?? null;
  } else if (byHint.has(key)) {
    target = byHint.get(key)?.e ?? null;
  } else {
    const want = key.replace(/[^a-z0-9 ]/g, "").trim();
    target = targets.find((t) => String(t.name).toLowerCase().includes(want))?.e ?? null;
  }

  if (!target) return null;
  return { target, desiredRadius, targetLabel: targetRaw };
}

export async function handleWalkToCommand(
  ctx: MudContext,
  char: CharacterState,
  input: MudInput
): Promise<string> {
  const world = (input as any).world ?? (ctx as any).world;
  if (!world) return "The world is unavailable.";

  const argv0 = toArgArray(input?.args?.length ? input.args : input?.parts);
  const { radiusOverride, maxStepsOverride, stepDelayOverride, riskArg, coward, keep } =
    parseOptions(argv0);

  // Mode controls (can be used with or without a target)
  const cooldownMs = clamp(envInt("PW_WALKTO_RISK_TOGGLE_CD_MS", 300_000), 0, 3_600_000);

  if (coward) {
    // Always allow disabling; also clear cowardice stacks.
    if (riskEnabled(char)) setRiskEnabled(char, false, cooldownMs);
    clearCowardice(char);
    if (keep.length === 0) {
      return `[walk] Risk mode disabled. Re-enable available in ${formatMs(riskCooldownRemainingMs(char))}.`;
    }
  }

  if (riskArg !== undefined) {
    // "--risk" was present (with optional arg)
    const arg = riskArg === null ? "" : norm(riskArg);

    if (arg === "status" || arg === "state" || arg === "check") {
      return riskStatusLine(char);
    }

    if (riskEnabled(char)) {
      // "--risk" while enabled toggles it off (no extra confirmation needed)
      setRiskEnabled(char, false, cooldownMs);
      if (keep.length === 0) {
        return `[walk] Risk mode disabled. Re-enable available in ${formatMs(riskCooldownRemainingMs(char))}.`;
      }
      // If a target is also present, continue the walk (now safely).
    } else {
      // Not enabled yet
      if (arg === "yes" || arg === "y" || arg === "on" || arg === "enable") {
        const cd = riskCooldownRemainingMs(char);
        if (cd > 0) {
          return `[walk] Risk mode can't be enabled yet. Cooldown remaining: ${formatMs(cd)}.`;
        }
        getFlags(char).walktoRiskEnabled = true;
        // enabling doesn't set cooldown; cooldown applies on disable to prevent toggle abuse
        if (keep.length === 0) return "[walk] Risk mode ENABLED. (Use: walkto --coward to disable)";
        // Continue to walk to target with risk mode ON.
      } else {
        // show warning + instruction
        return riskWarning();
      }
    }
  }

  // Resolve target
  const targetRaw = keep.join(" ").trim();
  if (!targetRaw) {
    return [
      "Usage:",
      "  walkto <bank|gbank|mail|ah|vendor|handle|name> [--radius N] [--max N] [--delay ms]",
      "  walkto --risk            (show warning / disable if already enabled)",
      "  walkto --risk yes        (enable risk mode)",
      "  walkto --risk status     (show status)",
      "  walkto --coward          (disable risk mode + clear cowardice)",
    ].join("\n");
  }

  const roomId = getRoomId(ctx, char);
  if (!roomId) return "You are not in a room yet.";

  const resolved = resolveTarget(ctx, char, roomId, targetRaw);
  if (!resolved) {
    // Special case: service keyword with no anchor
    const svc = isServiceKeyword(targetRaw);
    if (svc) return `No ${svc} service anchor found nearby. (Try 'nearby' or hydrate town baselines.)`;
    return `Can't find '${targetRaw}' here. (Try 'nearby' and use the handle, like 'mailbox.1'.)`;
  }

  let { target, desiredRadius } = resolved;

  // apply overrides
  if (typeof radiusOverride === "number" && Number.isFinite(radiusOverride)) desiredRadius = radiusOverride;

  const maxSteps = Math.max(1, maxStepsOverride ?? envInt("PW_WALKTO_MAX_STEPS", 160));

  // Anti-exploit throttle (feels like walking; lets hostile territory bite)
  const stepDelayMs = Math.max(0, stepDelayOverride ?? envInt("PW_WALKTO_STEP_DELAY_MS", 50));

  // Safety: if risk mode is not enabled, block usage in combat.
  const risk = riskEnabled(char);
  if (!risk && isInCombat(ctx, char)) {
    return "[walk] You can't auto-walk while in combat. (Enable risk mode if you insist: walkto --risk)";
  }

  const tx = typeof target.x === "number" ? target.x : 0;
  const tz = typeof target.z === "number" ? target.z : 0;

  let moved = 0;
  let preferX = true;
  let sawCombatDuringWalk = false;

  while (moved < maxSteps) {
    const inCombat = isInCombat(ctx, char);

    // If we're not risking, combat immediately stops the walk.
    if (!risk && inCombat) {
      const { x: px, z: pz } = getPlayerXZ(ctx, char);
      const remaining = distanceXZ(px, pz, tx, tz);
      return `[walk] Stopped: you were engaged in combat. (moved ${moved} step(s), remaining dist ~${remaining.toFixed(
        1
      )})`;
    }

    // If we ARE risking and combat is present, apply/extend cowardice once per walk start / combat transition.
    if (risk && inCombat) {
      if (!sawCombatDuringWalk) {
        sawCombatDuringWalk = true;
        applyCowardiceStack(char);
      }
    }

    const { x: px, z: pz } = getPlayerXZ(ctx, char);
    const dist = distanceXZ(px, pz, tx, tz);

    if (dist <= desiredRadius) {
      const name = String(target.name ?? target.id ?? targetRaw);
      const extra =
        risk && sawCombatDuringWalk
          ? ` | cowardice: ${getFlags(char).walktoCowardiceStacks ?? 1} stack(s)`
          : "";
      return `[walk] You arrive near ${name}. (${moved} step(s), dist ${dist.toFixed(1)} ≤ ${desiredRadius})${extra}`;
    }

    const dx = tx - px;
    const dz = tz - pz;
    const step = stepDirTowards(dx, dz, preferX);
    preferX = !preferX;

    const dir = parseMoveDir(step);
    if (!dir) return "[walk] Internal error: could not parse direction.";

    const res = await moveCharacterAndSync(ctx, char, dir, world, 1);
    if (!res.ok) {
      const remaining = distanceXZ(px, pz, tx, tz);
      return `[walk] Stopped after ${moved} step(s): ${res.reason} (remaining dist ~${remaining.toFixed(1)})`;
    }

    moved++;

    if (stepDelayMs > 0) {
      await sleep(stepDelayMs);
    }
  }

  const { x: fx, z: fz } = getPlayerXZ(ctx, char);
  const remaining = distanceXZ(fx, fz, tx, tz);
  return `[walk] Max steps reached (${maxSteps}). Remaining dist ~${remaining.toFixed(1)} (need ≤ ${desiredRadius}).`;
}
