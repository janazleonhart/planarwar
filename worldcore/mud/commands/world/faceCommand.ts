// worldcore/mud/commands/world/faceCommand.ts

import { resolveTargetInRoom } from "../../../targeting/TargetResolver";
import type { MudCommandInput } from "../types";
import type { CharacterState } from "../../../characters/CharacterTypes";
import type { MudContext } from "../../MudContext";

function normalizeAngleRad(r: number): number {
  let x = r;
  const twoPi = Math.PI * 2;
  // bring into [0, 2π)
  x = ((x % twoPi) + twoPi) % twoPi;
  // then into (-π, π]
  if (x > Math.PI) x -= twoPi;
  return x;
}

function radToDeg(r: number): number {
  return (r * 180) / Math.PI;
}

function degToRad(d: number): number {
  return (d * Math.PI) / 180;
}

function formatHeading(rotY: number): { deg: number; label: string } {
  // rotY=0 => forward +Z. We'll call that "north".
  const r = normalizeAngleRad(rotY);
  let deg = radToDeg(r);
  // Convert to [0, 360)
  deg = ((deg % 360) + 360) % 360;

  const dirs: { label: string; deg: number }[] = [
    { label: "north", deg: 0 },
    { label: "northeast", deg: 45 },
    { label: "east", deg: 90 },
    { label: "southeast", deg: 135 },
    { label: "south", deg: 180 },
    { label: "southwest", deg: 225 },
    { label: "west", deg: 270 },
    { label: "northwest", deg: 315 },
  ];

  // Find nearest 45° direction
  let best = dirs[0];
  let bestDist = 999999;
  for (const d of dirs) {
    const delta = Math.min(
      Math.abs(deg - d.deg),
      360 - Math.abs(deg - d.deg),
    );
    if (delta < bestDist) {
      bestDist = delta;
      best = d;
    }
  }

  return { deg: Math.round(deg * 10) / 10, label: best.label };
}

function parseFacingToken(tokenRaw: string): number | null {
  const t = tokenRaw.trim().toLowerCase();
  if (!t) return null;

  const table: Record<string, number> = {
    n: 0,
    north: 0,
    ne: 45,
    northeast: 45,
    e: 90,
    east: 90,
    se: 135,
    southeast: 135,
    s: 180,
    south: 180,
    sw: 225,
    southwest: 225,
    w: 270,
    west: 270,
    nw: 315,
    northwest: 315,
  };

  if (t in table) return degToRad(table[t]);

  // Accept: "90", "90deg", "90°", "-45"
  const cleaned = t.replace(/deg$/g, "").replace(/°$/g, "");
  const n = Number(cleaned);
  if (Number.isFinite(n)) {
    // Normalize degrees then convert
    const deg = ((n % 360) + 360) % 360;
    return normalizeAngleRad(degToRad(deg));
  }

  return null;
}

function faceToward(self: any, target: any): number {
  const sx = Number(self?.x ?? 0);
  const sz = Number(self?.z ?? 0);
  const tx = Number(target?.x ?? 0);
  const tz = Number(target?.z ?? 0);
  const dx = tx - sx;
  const dz = tz - sz;

  // atan2(dx, dz) matches MudCombatActions "toTargetYaw"
  const yaw = Math.atan2(dx, dz);
  return normalizeAngleRad(yaw);
}

function setFacing(ctx: MudContext, char: CharacterState, rotY: number): void {
  const r = normalizeAngleRad(rotY);

  // Character state (used by various services)
  (char as any).rotY = r;

  // Entity state (used by ranged LoS / other players)
  try {
    const selfEntity = (ctx as any)?.entities?.getEntityByOwner?.((ctx as any)?.session?.id);
    if (selfEntity) selfEntity.rotY = r;
  } catch {
    // ignore
  }
}

export async function handleFaceCommand(
  ctx: MudContext,
  char: CharacterState,
  input: MudCommandInput,
): Promise<string> {
  const args = input.args ?? [];
  const tokenRaw = String(args[0] ?? "").trim();

  const selfEntity = (ctx as any)?.entities?.getEntityByOwner?.((ctx as any)?.session?.id);
  const currentRot = Number((selfEntity as any)?.rotY ?? (char as any)?.rotY ?? 0);
  const current = formatHeading(currentRot);

  if (!tokenRaw) {
    return `You are facing ${current.label} (${current.deg}°).`;
  }

  // 1) Parse as explicit direction/angle
  const parsed = parseFacingToken(tokenRaw);
  if (parsed !== null) {
    setFacing(ctx, char, parsed);
    const next = formatHeading(parsed);
    return `You face ${next.label} (${next.deg}°).`;
  }

  // 2) Otherwise treat as a target in the room and face toward it
  if (!(ctx as any)?.entities) return "You have no body here.";

  const roomId = String((selfEntity as any)?.roomId ?? (ctx as any)?.session?.roomId ?? (char as any)?.shardId ?? "");
  const target = resolveTargetInRoom((ctx as any).entities, roomId, tokenRaw, {
    selfId: (selfEntity as any)?.id,
    // allow facing any non-corpse entity by default
    filter: (e: any) => e && e.roomId === roomId && e.type !== "corpse",
    radius: 9999,
  });

  if (!target) {
    return `No such target to face: '${tokenRaw}'.`;
  }

  const yaw = faceToward(selfEntity ?? char, target);
  setFacing(ctx, char, yaw);
  const next = formatHeading(yaw);

  return `You face ${target.name ?? "the target"} (${next.label}, ${next.deg}°).`;
}
