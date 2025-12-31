// worldcore/mud/commands/world/inspectRegionCommand.ts

function fmt(n: unknown, digits: number = 2): string {
  return typeof n === "number" && Number.isFinite(n) ? n.toFixed(digits) : "?";
}

function parseNumToken(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const cleaned = s.trim().replace(/,+$/, ""); // "128," -> "128"
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : undefined;
}

function parseCellToken(token: string): { cx: number; cz: number } | undefined {
  // Accept:
  //  - "0,0"
  //  - "prime_shard:0,0"
  const t = token.includes(":") ? token.split(":").slice(1).join(":") : token;
  const parts = t.split(",");
  if (parts.length !== 2) return undefined;

  const cx = parseNumToken(parts[0]);
  const cz = parseNumToken(parts[1]);
  if (cx === undefined || cz === undefined) return undefined;

  return { cx: Math.trunc(cx), cz: Math.trunc(cz) };
}

function extractCellFromRegionId(id: string | undefined): { cx: number; cz: number } | undefined {
  if (!id) return undefined;
  const idx = id.indexOf(":");
  const tail = idx >= 0 ? id.slice(idx + 1) : id;
  const parts = tail.split(",");
  if (parts.length !== 2) return undefined;
  const cx = parseNumToken(parts[0]);
  const cz = parseNumToken(parts[1]);
  if (cx === undefined || cz === undefined) return undefined;
  return { cx: Math.trunc(cx), cz: Math.trunc(cz) };
}

function listSemantic(flags: any, tags: string[]): string[] {
  const out: string[] = [];
  const isTown = !!flags?.isTown || tags.includes("town") || tags.includes("city");
  const isSafeHub = !!flags?.isSafeHub || tags.includes("safe_hub") || tags.includes("sanctuary");
  const isGraveyard = !!flags?.isGraveyard || tags.includes("graveyard") || tags.includes("gy");
  const isLawless = !!flags?.isLawless || tags.includes("lawless");

  if (isTown) out.push("town");
  if (isSafeHub) out.push("safe hub");
  if (isGraveyard) out.push("graveyard");
  if (isLawless) out.push("lawless");
  return out;
}

export async function handleInspectRegionCommand(
  _ctx: any,
  char: any,
  input: { cmd: string; args: string[]; parts: string[]; world?: any },
): Promise<string> {
  const world = input.world;
  if (!world) return "The world is unavailable.";

  const args: string[] = Array.isArray(input.args) ? input.args : [];

  // Default to character position.
  const charX = typeof char?.posX === "number" ? char.posX : 0;
  const charZ = typeof char?.posZ === "number" ? char.posZ : 0;

  let x = charX;
  let z = charZ;
  let queryMode = "character";

  // inspect_region <x> <z>  (also supports: inspect_region 128, 0)
  if (args.length >= 2) {
    const nx = parseNumToken(args[0]);
    const nz = parseNumToken(args[1]);
    if (nx !== undefined && nz !== undefined) {
      x = nx;
      z = nz;
      queryMode = "coords";
    }
  }

  // inspect_region <cell>  (ex: 0,0 or prime_shard:0,0)
  if (args.length === 1) {
    const cell = parseCellToken(args[0]);
    if (cell) {
      const cellSize =
        typeof world.getRegionMap?.().cellSize === "number" ? world.getRegionMap().cellSize : 64;

      // center of the cell
      x = cell.cx * cellSize + cellSize / 2;
      z = cell.cz * cellSize + cellSize / 2;
      queryMode = `cell ${cell.cx},${cell.cz}`;
    }
  }

  const region = typeof world.getRegionAt === "function" ? world.getRegionAt(x, z) : null;
  if (!region) {
    return `No region at (${fmt(x)}, ${fmt(z)}). (Likely outside world bounds.)`;
  }

  const id: string = region.id ?? "unknown";
  const cellFromId = extractCellFromRegionId(id);
  const fallbackName =
    cellFromId ? `Region ${cellFromId.cx},${cellFromId.cz}` : "Unnamed region";

  const name: string = typeof region.name === "string" ? region.name : fallbackName;

  const tier =
    typeof (region as any).tier === "number"
      ? (region as any).tier
      : typeof (region as any).level === "number"
        ? (region as any).level
        : undefined;

  const lawLevel = typeof (region as any).lawLevel === "number" ? (region as any).lawLevel : undefined;

  const biome = (region as any).biome ?? "?";
  const tags: string[] = Array.isArray((region as any).tags) ? (region as any).tags : [];
  const flags = ((region as any).flags ?? {}) as any;

  const semantic = listSemantic(flags, tags);

  // Sample detail (if RegionMap exposes it)
  let sampleLine = `Sample: ?`;
  try {
    const rm = world.getRegionMap?.();
    const sample = rm?.sampleAt?.(x, z);
    if (sample) {
      sampleLine = `Sample: height=${fmt(sample.height)} slope=${fmt(sample.slope)}`;
    }
  } catch {
    // ignore
  }

  const tagsText = tags.length ? tags.join(", ") : "none";
  const semanticText = semantic.length ? semantic.join(", ") : "none";
  const cellText = cellFromId ? `${cellFromId.cx},${cellFromId.cz}` : "?";

  return [
    `Region: ${name} [${id}]`,
    `Cell: ${cellText} | Biome: ${biome}${tier !== undefined ? ` | Tier: ${tier}` : ""}${
      lawLevel !== undefined ? ` | Law: ${lawLevel}` : ""
    }`,
    `Query: ${queryMode} @ (${fmt(x)}, ${fmt(z)})`,
    `Char: (${fmt(charX)}, ${fmt(charZ)}) lastRegionId=${char?.lastRegionId ?? "null"}`,
    sampleLine,
    `Tags: ${tagsText}`,
    `Semantic: ${semanticText}`,
  ].join("\n");
}
