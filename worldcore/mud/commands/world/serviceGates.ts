// worldcore/mud/commands/world/serviceGates.ts
import type { MudContext } from "../../MudContext";
import type { CharacterState } from "../../../characters/CharacterTypes";
import { isGMOrHigher } from "../../../shared/AuthTypes";

type ServiceName = "bank" | "guildbank" | "vendor" | "auction" | "mail";

function envBool(name: string): boolean {
  const v = (process.env[name] ?? "").toString().trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/**
 * Enable/disable world service gating.
 *
 * - default: OFF (dev friendly)
 * - enable: PW_SERVICE_GATES=1 (or WORLD_SERVICE_GATES=1)
 */
export function serviceGatesEnabled(): boolean {
  return envBool("PW_SERVICE_GATES") || envBool("WORLD_SERVICE_GATES");
}

function getPlayerXZ(ctx: MudContext, char: CharacterState): { x: number; z: number } {
  const ent = ctx.entities?.getEntityByOwner?.(ctx.session.id) as any;
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

function isStaffBypass(ctx: MudContext): boolean {
  const flags = (ctx.session as any)?.identity?.flags;
  return isGMOrHigher(flags);
}

function isTownLike(ctx: MudContext, x: number, z: number): boolean {
  const world: any = (ctx as any).world;
  if (!world?.getRegionAt) return true; // be permissive if world isn't wired
  const region = world.getRegionAt(x, z);
  const tags: string[] = Array.isArray(region?.tags) ? region.tags : [];
  const flags: any = region?.flags ?? {};
  return (
    tags.includes("town") ||
    tags.includes("safe_hub") ||
    flags.isTown === true ||
    flags.isSafeHub === true
  );
}

function deny(service: ServiceName): string {
  const nice =
    service === "guildbank"
      ? "Guild Bank"
      : service === "bank"
      ? "Bank"
      : service === "vendor"
      ? "Vendor"
      : service === "auction"
      ? "Auction House"
      : "Mail";

  return `${nice} is only available in towns (or safe hubs).`;
}

/**
 * Wrap a command so it only works while you're in a town/safe hub.
 * Staff (GM+) bypasses when gates are enabled.
 */
export async function requireTownService<T>(
  ctx: MudContext,
  char: CharacterState,
  service: ServiceName,
  run: () => Promise<T>
): Promise<T | string> {
  if (!serviceGatesEnabled()) return await run();
  if (isStaffBypass(ctx)) return await run();

  const { x, z } = getPlayerXZ(ctx, char);
  if (isTownLike(ctx, x, z)) return await run();

  return deny(service);
}
