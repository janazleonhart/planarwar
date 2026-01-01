// worldcore/mud/commands/world/inspectRegionCommand.ts

import type { MudContext } from "../../MudContext";
import type { CharacterState } from "../../../characters/CharacterTypes";
import { SpawnPointService } from "../../../world/SpawnPointService";

type CommandInput = {
  cmd: string;
  args: string[];
  parts: string[];
  world?: any;
};

function parseCoords(args: string[]): { x: number; z: number } | null {
  if (!args.length) return null;

  // supports:
  //   inspect_region 96 0
  //   inspect_region 96, 0
  //   inspect_region 96,0
  const joined = args.join(" ").trim();
  const m = joined.match(/^\s*(-?\d+(?:\.\d+)?)\s*(?:,|\s)\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (!m) return null;

  const x = Number(m[1]);
  const z = Number(m[2]);
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  return { x, z };
}

function parseCellFromRegionId(regionId: string): { shardId: string; cx: number; cz: number } | null {
  // prime_shard:3,2
  const idx = regionId.indexOf(":");
  if (idx <= 0) return null;
  const shardId = regionId.slice(0, idx);
  const rest = regionId.slice(idx + 1);
  const m = rest.match(/^(-?\d+),(-?\d+)$/);
  if (!m) return null;
  return { shardId, cx: Number(m[1]), cz: Number(m[2]) };
}

function fmtNum(n: unknown, digits = 2): string {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return "?";
  return v.toFixed(digits);
}

function fmtList(list: unknown): string {
  if (!Array.isArray(list)) return "none";
  const items = list.map((x) => String(x)).filter(Boolean);
  return items.length ? items.join(", ") : "none";
}

export async function handleInspectRegionCommand(
  ctx: MudContext,
  char: CharacterState,
  input: CommandInput,
): Promise<string> {
  const world = input.world ?? ctx.world;
  if (!world) return "The world is unavailable.";

  const query = parseCoords(input.args);
  const qx = query?.x ?? (char as any).posX ?? 0;
  const qz = query?.z ?? (char as any).posZ ?? 0;

  const cx = (char as any).posX ?? 0;
  const cz = (char as any).posZ ?? 0;

  const region = typeof world.getRegionAt === "function" ? world.getRegionAt(qx, qz) : null;
  if (!region) return "You are nowhere.";

  const regionId: string = region.id ?? region.regionId ?? "unknown";
  const parsed = typeof regionId === "string" ? parseCellFromRegionId(regionId) : null;

  const shardId = parsed?.shardId ?? (char as any).shardId ?? "prime_shard";
  const cellStr = parsed ? `Cell: ${parsed.cx},${parsed.cz} | ` : "";

  const name = region.name ?? region.displayName ?? `Region ${parsed?.cx ?? "?"},${parsed?.cz ?? "?"}`;
  const biome = region.biome ?? region.biomeId ?? "?";
  const tier = region.tier ?? region.difficultyTier ?? "?";
  const law = region.law ?? region.lawScore ?? "?";

  // Optional: sample terrain if the world exposes something
  let sampleHeight: string = "?";
  let sampleSlope: string = "?";
  try {
    if (typeof world.sampleTerrain === "function") {
      const s = world.sampleTerrain(qx, qz);
      sampleHeight = fmtNum(s?.height);
      sampleSlope = fmtNum(s?.slope);
    } else if (region && typeof region.sample === "function") {
      const s = region.sample(qx, qz);
      sampleHeight = fmtNum(s?.height);
      sampleSlope = fmtNum(s?.slope);
    }
  } catch {
    // ignore sampling failures
  }

  const tags = fmtList(region.tags);
  const semantic = fmtList(region.semantic ?? region.semantics ?? region.labels);

  const queryLabel = query ? `coords @ (${fmtNum(qx)}, ${fmtNum(qz)})` : `character @ (${fmtNum(cx)}, ${fmtNum(cz)})`;

  let out =
    `Region: ${name} [${regionId}]\n` +
    `${cellStr}Biome: ${biome} | Tier: ${tier} | Law: ${law}\n` +
    `Query: ${queryLabel}\n` +
    `Char: (${fmtNum(cx)}, ${fmtNum(cz)}) lastRegionId=${(char as any).lastRegionId ?? "?"}\n` +
    `Sample: height=${sampleHeight} slope=${sampleSlope}\n` +
    `Tags: ${tags}\n` +
    `Semantic: ${semantic}`;

  // NEW: show spawn_points that live in this region (and near the query point)
  try {
    const sp = new SpawnPointService();

    const regionSpawns = await sp.getSpawnPointsForRegion(shardId, regionId);
    const nearSpawns = await sp.getSpawnPointsNear(shardId, qx, qz, 10);

    const lines: string[] = [];
    lines.push("");
    lines.push(`SpawnPoints: region=${regionSpawns.length} near(10)=${nearSpawns.length}`);

    const top = regionSpawns.slice(0, 12);
    for (const s of top) {
      lines.push(
        `- ${s.spawnId} type=${s.type} proto=${s.protoId}` +
          (s.variantId ? ` variant=${s.variantId}` : "") +
          ` @ (${fmtNum(s.x)}, ${fmtNum(s.z)})`,
      );
    }

    if (regionSpawns.length > top.length) {
      lines.push(`(… ${regionSpawns.length - top.length} more)`);
    }

    out += "\n" + lines.join("\n");
  } catch (e: any) {
    out += `\n\nSpawnPoints: (query failed) ${e?.message ?? String(e)}`;
  }

  return out;
}
