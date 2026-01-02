// worldcore/mud/commands/world/walktoCommand.ts

import type { MudContext } from "../../MudContext";
import type { CharacterState } from "../../../characters/CharacterTypes";
import { moveCharacterAndSync } from "../../../movement/moveOps";
import { parseMoveDir } from "../../../movement/MovementCommands";

// NOTE: this command intentionally does NOT depend on a global MudInput type.
// Different command handlers in this repo accept slightly different input shapes.
// We'll normalize args safely via `toArgArray()`.

type MudInput = {
  cmd?: string;
  args?: string[];
  parts?: string[];
  world?: any;
};

type WalkTarget =
  | { kind: "entity"; id: string; name?: string; x: number; z: number }
  | { kind: "coords"; x: number; z: number; name?: string }
  | { kind: "service"; service: ServiceName; name?: string; x: number; z: number };

type ServiceName = "bank" | "guildbank" | "vendor" | "auction" | "mail";

type WalkOptions = {
  radiusOverride?: number;
  maxStepsOverride?: number;
  stepDelayOverride?: number;
  riskArg?: string | null; // null if provided without value
  coward?: boolean;
  keep: string[]; // remaining args after options
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function envInt(name: string, fallback: number): number {
  const raw = String(process.env[name] ?? "").trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

function envFloat(name: string, fallback: number): number {
  const raw = String(process.env[name] ?? "").trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return n;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function norm(s: any): string {
  return String(s ?? "").trim();
}

function toArgArray(parts: any): string[] {
  if (Array.isArray(parts)) return parts.map((x) => String(x));
  return [];
}

function distanceXZ(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx;
  const dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

function getFlags(char: CharacterState): any {
  const p: any = (char as any).progression ?? ((char as any).progression = {});
  const f: any = p.flags ?? (p.flags = {});
  return f;
}

function getSelfEntity(ctx: MudContext): any | null {
  try {
    return (ctx.entities as any)?.getEntityByOwner?.(ctx.session.id) ?? null;
  } catch {
    return null;
  }
}

function syncWalktoFlagsToEntity(ctx: MudContext, char: CharacterState): void {
  const ent = getSelfEntity(ctx);
  if (!ent) return;

  const flags = getFlags(char);
  const e: any = ent;

  e._pw_walktoRiskEnabled = !!flags.walktoRiskEnabled;
  e._pw_walktoCowardiceStacks = flags.walktoCowardiceStacks ?? 0;
  e._pw_walktoCowardiceUntilMs = flags.walktoCowardiceUntilMs ?? 0;
}

function setWalktoActive(ctx: MudContext, active: boolean): void {
  const ent = getSelfEntity(ctx);
  if (!ent) return;
  const e: any = ent;

  e._pw_walktoActive = !!active;
  // always clear stale cancel requests when (re)starting/stopping
  e._pw_walktoCancelRequestedAtMs = 0;
}

function consumeWalktoCancelRequestMs(ctx: MudContext): number {
  const ent = getSelfEntity(ctx);
  if (!ent) return 0;
  const e: any = ent;

  const t = Number(e._pw_walktoCancelRequestedAtMs ?? 0);
  if (!Number.isFinite(t) || t <= 0) return 0;
  e._pw_walktoCancelRequestedAtMs = 0;
  return t;
}

function getRoomId(ctx: MudContext, char: CharacterState): string | null {
  const roomId = (ctx as any)?.session?.roomId;
  if (roomId) return String(roomId);
  const rid = (char as any)?.roomId;
  return rid ? String(rid) : null;
}

function getPlayerXZ(ctx: MudContext, char: CharacterState): { x: number; z: number } {
  const e: any = (ctx.entities as any)?.getEntityByOwner?.((ctx as any).session?.id);
  const x = typeof e?.x === "number" ? e.x : (char as any).posX ?? 0;
  const z = typeof e?.z === "number" ? e.z : (char as any).posZ ?? 0;
  return { x, z };
}

function isInCombat(ctx: MudContext, _char: CharacterState): boolean {
  const e: any = (ctx.entities as any)?.getEntityByOwner?.((ctx as any).session?.id);
  if (!e) return false;
  const until = Number(e.inCombatUntil ?? 0);
  return Number.isFinite(until) && Date.now() <= until;
}

function parseServiceName(raw: string): ServiceName | null {
  const s = norm(raw).toLowerCase();
  if (!s) return null;
  if (s === "bank") return "bank";
  if (s === "gbank" || s === "guildbank") return "guildbank";
  if (s === "vendor" || s === "shop") return "vendor";
  if (s === "ah" || s === "auction" || s === "auctionhouse") return "auction";
  if (s === "mail" || s === "mailbox") return "mail";
  return null;
}

function findNearestServiceAnchor(
  ctx: MudContext,
  roomId: string,
  service: ServiceName,
  fromX: number,
  fromZ: number
): { x: number; z: number; name?: string } | null {
  const ents: any[] = (ctx.entities as any)?.getEntitiesInRoom?.(roomId) ?? [];
  if (!Array.isArray(ents) || ents.length === 0) return null;

  const matches = ents.filter((e) => {
    if (!e) return false;
    const t = norm(e.type).toLowerCase();
    const name = norm(e.name).toLowerCase();
    const id = norm(e.id).toLowerCase();

    // v1: match by type + name hints (tune later; registry-backed "services" can formalize this)
    if (service === "mail") return t === "mailbox" || name.includes("mail") || id.includes("mail");
    if (service === "bank") return t === "bank" || name.includes("bank") || id.includes("bank");
    if (service === "guildbank") return t === "guildbank" || name.includes("guild bank") || id.includes("gbank");
    if (service === "vendor") return t === "vendor" || name.includes("vendor") || name.includes("shop");
    if (service === "auction") return t === "auction" || name.includes("auction") || id.includes("auction");
    return false;
  });

  if (matches.length === 0) return null;

  let best: any = null;
  let bestD = Infinity;
  for (const e of matches) {
    const x = typeof e.x === "number" ? e.x : 0;
    const z = typeof e.z === "number" ? e.z : 0;
    const d = distanceXZ(fromX, fromZ, x, z);
    if (d < bestD) {
      best = e;
      bestD = d;
    }
  }

  if (!best) return null;
  return { x: best.x ?? 0, z: best.z ?? 0, name: best.name ?? best.id };
}

function parseOptions(argv: string[]): WalkOptions {
  const out: WalkOptions = { keep: [] };

  const args = [...argv];
  while (args.length > 0) {
    const a = String(args[0] ?? "").trim();

    if (a === "--radius" && args.length >= 2) {
      args.shift();
      out.radiusOverride = Number(args.shift());
      continue;
    }
    if (a === "--maxSteps" && args.length >= 2) {
      args.shift();
      out.maxStepsOverride = Number(args.shift());
      continue;
    }
    if (a === "--delay" && args.length >= 2) {
      args.shift();
      out.stepDelayOverride = Number(args.shift());
      continue;
    }

    if (a === "--risk") {
      args.shift();
      // optional value
      const next = args[0];
      if (next && !String(next).startsWith("--")) {
        out.riskArg = String(args.shift());
      } else {
        out.riskArg = null;
      }
      continue;
    }

    if (a === "--coward") {
      args.shift();
      out.coward = true;
      continue;
    }

    // everything else: keep
    out.keep.push(String(args.shift()));
  }

  return out;
}

function riskEnabled(char: CharacterState): boolean {
  return !!getFlags(char).walktoRiskEnabled;
}

function riskCooldownRemainingMs(char: CharacterState): number {
  const flags = getFlags(char);
  const until = Number(flags.walktoRiskCooldownUntilMs ?? 0);
  if (!Number.isFinite(until) || until <= 0) return 0;
  return Math.max(0, until - Date.now());
}

function setRiskEnabled(char: CharacterState, enabled: boolean, cooldownMs: number): void {
  const flags = getFlags(char);
  flags.walktoRiskEnabled = !!enabled;
  if (!enabled) {
    // toggling OFF starts a cooldown before it can be re-enabled again
    flags.walktoRiskCooldownUntilMs = Date.now() + Math.max(0, cooldownMs);
  }
}

function clearCowardice(char: CharacterState): void {
  const flags = getFlags(char);
  delete flags.walktoCowardiceStacks;
  delete flags.walktoCowardiceUntilMs;
  delete flags.walktoCowardiceLastAppliedAtMs;
}

function applyCowardiceStack(char: CharacterState): void {
  const flags = getFlags(char);

  const maxStacks = clamp(envInt("PW_WALKTO_COWARDICE_MAX_STACKS", 10), 1, 100);
  const durationMs = clamp(envInt("PW_WALKTO_COWARDICE_DURATION_MS", 300_000), 5_000, 3_600_000);
  const minReapplyGapMs = clamp(envInt("PW_WALKTO_COWARDICE_MIN_REAPPLY_GAP_MS", 2_000), 0, 60_000);

  const now = Date.now();

  const last = Number(flags.walktoCowardiceLastAppliedAtMs ?? 0);
  if (Number.isFinite(last) && last > 0 && now - last < minReapplyGapMs) {
    // Too soon; don't spam stacks.
    return;
  }

  const oldStacks = Number(flags.walktoCowardiceStacks ?? 0);
  const stacks = clamp((Number.isFinite(oldStacks) ? oldStacks : 0) + 1, 1, maxStacks);

  flags.walktoCowardiceStacks = stacks;
  flags.walktoCowardiceUntilMs = now + durationMs;
  flags.walktoCowardiceLastAppliedAtMs = now;
}

function formatMs(ms: number): string {
  const s = Math.ceil(ms / 1000);
  if (s <= 0) return "0s";
  if (s < 60) return `${s}s`;
  const m = Math.ceil(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.ceil(m / 60);
  return `${h}h`;
}

function riskStatusLine(char: CharacterState): string {
  const enabled = riskEnabled(char);
  const cd = riskCooldownRemainingMs(char);
  const flags = getFlags(char);
  const stacks = Number(flags.walktoCowardiceStacks ?? 0);
  const until = Number(flags.walktoCowardiceUntilMs ?? 0);
  const now = Date.now();
  const active = Number.isFinite(until) && until > now;

  return `[walk] risk=${enabled ? "ON" : "off"} | cooldown=${cd > 0 ? formatMs(cd) : "none"} | cowardice=${
    active ? `${stacks || 1} stack(s) (${formatMs(until - now)} left)` : "none"
  }`;
}

function parseCoords(raw: string): { x: number; z: number } | null {
  const s = norm(raw);
  if (!s) return null;

  // allow: "x,z" or "x z"
  const parts = s.split(/[,\s]+/).filter(Boolean);
  if (parts.length < 2) return null;

  const x = Number(parts[0]);
  const z = Number(parts[1]);
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;

  return { x, z };
}

function stepDirTowards(dx: number, dz: number, preferX: boolean): string {
  // pick the dominant axis, alternating to avoid “staircase” stickiness
  if (preferX) {
    if (Math.abs(dx) >= Math.abs(dz)) return dx >= 0 ? "e" : "w";
    return dz >= 0 ? "s" : "n";
  } else {
    if (Math.abs(dz) >= Math.abs(dx)) return dz >= 0 ? "s" : "n";
    return dx >= 0 ? "e" : "w";
  }
}

async function resolveTarget(
  ctx: MudContext,
  char: CharacterState,
  roomId: string,
  targetRaw: string
): Promise<WalkTarget | null> {
  const raw = norm(targetRaw);
  if (!raw) return null;

  // Service keywords: walkto bank/mail/vendor/ah/gbank
  const svc = parseServiceName(raw);
  if (svc) {
    const { x: px, z: pz } = getPlayerXZ(ctx, char);
    const found = findNearestServiceAnchor(ctx, roomId, svc, px, pz);
    if (!found) return null;
    return { kind: "service", service: svc, x: found.x, z: found.z, name: found.name ?? raw };
  }

  // Coordinates: "x,z"
  const coords = parseCoords(raw);
  if (coords) return { kind: "coords", x: coords.x, z: coords.z, name: raw };

  // Entity handle: try matching by id/name substring in room
  const ents: any[] = (ctx.entities as any)?.getEntitiesInRoom?.(roomId) ?? [];
  const lowered = raw.toLowerCase();

  let best: any = null;
  for (const e of ents) {
    if (!e) continue;
    const id = norm(e.id).toLowerCase();
    const name = norm(e.name).toLowerCase();

    if (id === lowered || name === lowered) {
      best = e;
      break;
    }

    // substring match as a fallback
    if (!best && (id.includes(lowered) || name.includes(lowered))) best = e;
  }

  if (!best) return null;

  return {
    kind: "entity",
    id: String(best.id ?? raw),
    name: best.name ?? best.id ?? raw,
    x: typeof best.x === "number" ? best.x : 0,
    z: typeof best.z === "number" ? best.z : 0,
  };
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

  // Mirror persisted walkto flags onto the live player entity (combat penalties + interrupts).
  syncWalktoFlagsToEntity(ctx, char);

  // Mode controls (can be used with or without a target)
  const cooldownMs = clamp(envInt("PW_WALKTO_RISK_TOGGLE_CD_MS", 300_000), 0, 3_600_000);

  if (coward) {
    // Clears cowardice stacks. If risk is enabled, toggles it off too (starting cooldown).
    if (riskEnabled(char)) setRiskEnabled(char, false, cooldownMs);
    clearCowardice(char);
    syncWalktoFlagsToEntity(ctx, char);
    return "[walk] Cowardice cleared. (risk disabled if it was enabled)";
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
      syncWalktoFlagsToEntity(ctx, char);
      if (keep.length === 0) {
        return `[walk] Risk mode disabled. Re-enable available in ${formatMs(
          riskCooldownRemainingMs(char)
        )}.`;
      }
      // If a target is also present, continue the walk
    } else {
      // enabling risk: honor cooldown; require confirm arg unless explicitly "yes/on/true"
      const cd = riskCooldownRemainingMs(char);
      if (cd > 0) {
        if (keep.length === 0) {
          return `[walk] Risk mode re-enable is on cooldown for ${formatMs(cd)}.`;
        }
      } else {
        const ok = ["1", "true", "yes", "on", "enable", "enabled"].includes(arg.toLowerCase());
        if (!ok) {
          return `[walk] Risk mode allows auto-walk through combat with penalties. To enable: walkto --risk yes`;
        }
        getFlags(char).walktoRiskEnabled = true;
        syncWalktoFlagsToEntity(ctx, char);
        if (keep.length === 0) {
          return "[walk] Risk mode enabled. (Cowardice penalties apply if you get into fights while auto-walking.)";
        }
      }
    }
  }

  // If no target provided, show status/help.
  const targetRaw = keep[0];
  if (!targetRaw) {
    return [
      "[walk] Usage: walkto <handle|name|x,z|service>",
      "[walk] Services: bank | gbank | mail | vendor | ah",
      "[walk] Options: --radius N --maxSteps N --delay MS --risk [yes|status] --coward",
      riskStatusLine(char),
    ].join("\n");
  }

  const roomId = getRoomId(ctx, char);
  if (!roomId) return "[walk] You are not in a world room.";

  const target = await resolveTarget(ctx, char, roomId, targetRaw);
  if (!target) {
    return `[walk] Could not find target '${targetRaw}'. Try 'nearby' first, or use coords 'x,z'.`;
  }

  // Tunables
  const desiredRadius = clamp(
    radiusOverride ?? envFloat("PW_WALKTO_RADIUS", 2.5),
    0.5,
    50
  );
  const maxSteps = clamp(
    maxStepsOverride ?? envInt("PW_WALKTO_MAX_STEPS", 4096),
    1,
    200_000
  );

  // Soft throttle (feels like walking; lets hostile territory bite)
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

  // NOTE: mark walkto active so combat can interrupt it on hit
  setWalktoActive(ctx, true);

  try {
    while (moved < maxSteps) {
    // If the player takes damage mid-walk, combat requests cancellation.
    // We honor that only when NOT in risk mode.
    if (!risk) {
      const canceledAt = consumeWalktoCancelRequestMs(ctx);
      if (canceledAt > 0) {
        const { x: px, z: pz } = getPlayerXZ(ctx, char);
        const remaining = distanceXZ(px, pz, tx, tz);
        return `[walk] Stopped: you were hit. (moved ${moved} step(s), remaining dist ~${remaining.toFixed(1)})`;
      }
    }

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
        syncWalktoFlagsToEntity(ctx, char);
      }
    }

    const { x: px, z: pz } = getPlayerXZ(ctx, char);
    const dist = distanceXZ(px, pz, tx, tz);

    if (dist <= desiredRadius) {
      const name = String((target as any).name ?? (target as any).id ?? targetRaw);
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
  } finally {
    setWalktoActive(ctx, false);
  }

  const { x: fx, z: fz } = getPlayerXZ(ctx, char);
  const remaining = distanceXZ(fx, fz, tx, tz);
  return `[walk] Max steps reached (${maxSteps}). Remaining dist ~${remaining.toFixed(1)} (need ≤ ${desiredRadius}).`;
}
