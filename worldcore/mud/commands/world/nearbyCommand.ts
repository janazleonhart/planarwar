// worldcore/mud/commands/world/nearbyCommand.ts

export async function handleNearbyCommand(
  ctx: any,
  char: any,
  _input: { cmd: string; args: string[]; parts: string[] }
): Promise<string> {
  const roomId = ctx.session.roomId;
  if (!roomId) return "You are not in a world room.";

  // v1 visibility rules (tune later)
  const MAX_RADIUS = 30;   // world units
  const MAX_RESULTS = 20;  // total items shown

  const originX = char.posX ?? 0;
  const originZ = char.posZ ?? 0;

  // --- v1: refresh personal nodes on-demand (after depletion timers expire) ---
  try {
    const shardId = char.shardId ?? "prime_shard";
    const regionId = char.lastRegionId ?? char.regionId ?? roomId;

    // npcSpawns is the NpcSpawnController instance (as used in server.ts)
    if (ctx.npcSpawns?.spawnPersonalNodesFromRegion) {
      await ctx.npcSpawns.spawnPersonalNodesFromRegion(
        shardId,
        regionId,
        roomId,
        ctx.session.id,
        char
      );
    }
  
      // --- v1: refresh POI placeholders (shared) on-demand ---
      // This is gated by WORLD_SPAWNS_ENABLED so prod can keep it off.
      const spawnsEnabled = String(process.env.WORLD_SPAWNS_ENABLED ?? "")
        .trim()
        .toLowerCase();
      if (
        spawnsEnabled === "1" ||
        spawnsEnabled === "true" ||
        spawnsEnabled === "yes" ||
        spawnsEnabled === "on"
      ) {
        if (ctx.spawnHydrator?.rehydrateRoom) {
          await ctx.spawnHydrator.rehydrateRoom({ shardId, regionId, roomId });
        }
      }
} catch (err) {
    // silent-ish; nearby should still work even if refresh fails
  }

  // IMPORTANT: query entities AFTER refresh, otherwise you print a stale snapshot.
  const entities = ctx.entities?.getEntitiesInRoom?.(roomId) ?? [];

  // Exclude self by entity id (NOT by ownerSessionId),
  // because personal nodes also have ownerSessionId.
  const self = ctx.entities?.getEntityByOwner?.(ctx.session.id);
  const selfId = self?.id;
  const others = entities.filter((e: any) => e && e.id && e.id !== selfId);

  if (others.length === 0) return "No nearby entities.";

  // Compute distance, filter by radius, then sort by distance then name
  const withDist = others
    .map((e: any) => {
      const dx = (e.x ?? 0) - originX;
      const dz = (e.z ?? 0) - originZ;
      const dist = Math.sqrt(dx * dx + dz * dz);
      return { e, dist };
    })
    .filter(({ dist }: any) => dist <= MAX_RADIUS)
    .sort((a: any, b: any) => {
      if (a.dist !== b.dist) return a.dist - b.dist;
      const an = String(a.e?.name ?? "").toLowerCase();
      const bn = String(b.e?.name ?? "").toLowerCase();
      if (an !== bn) return an.localeCompare(bn);
      return String(a.e?.id ?? "").localeCompare(String(b.e?.id ?? ""));
    })
    .slice(0, MAX_RESULTS);

  if (withDist.length === 0) {
    return `No nearby entities (within ${MAX_RADIUS}).`;
  }

  // Build short targets like rat.2 / vein.1 for convenience.
  const shortCounts = new Map<string, number>();
  const makeShort = (name: string): string => {
    const words = name
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, "")
      .split(/\s+/)
      .filter(Boolean);
    // Use the last word as a compact “handle” (Town Rat -> rat)
    return words[words.length - 1] ?? "entity";
  };

  const lines: string[] = [];
  let index = 1;

  for (const { e, dist } of withDist) {
    if (!e) continue;

    const hasSpawnPoint = typeof e?.spawnPointId === "number";

    // If it has an ownerSessionId but NO spawnPointId, it's a player-like entity,
    // even if e.type got corrupted to "node" somehow.
    const isPlayerLike = !!e?.ownerSessionId && !hasSpawnPoint;

    // Real nodes must have spawnPointId and be shared or owned by you
    const isRealNode =
      (e.type === "node" || e.type === "object") &&
      hasSpawnPoint &&
      (!e.ownerSessionId || e.ownerSessionId === ctx.session.id);

    // Hide foreign/invalid personal nodes entirely
    if ((e.type === "node" || e.type === "object") && !isRealNode) {
      // This is someone else's personal node or a malformed object → don't show it
      continue;
    }

    let kind: string;
    if (isPlayerLike) {
      kind = "player";
    } else if (e.type === "npc" || e.type === "mob") {
      kind = "npc";
    } else if (isRealNode) {
      kind = e.type; // node/object (yours/shared)
    } else {
      kind = e.type ?? "entity";
    }

    const name = String(e.name ?? e.id);
    const shortBase = makeShort(name);
    const shortKey = `${kind}:${shortBase}`;
    const n = (shortCounts.get(shortKey) ?? 0) + 1;
    shortCounts.set(shortKey, n);
    const hint = `${shortBase}.${n}`;

    lines.push(
      `${index}) [${kind}] ${name} (dist ${dist.toFixed(1)}) -> ${hint}`
    );
    index++;
  }

  if (lines.length === 0) {
    return `No nearby entities (within ${MAX_RADIUS}).`;
  }

  lines.push(
    `Tip: target by number (e.g. 'talk 2') or by handle (e.g. 'talk rat.1').`
  );

  return lines.join("\n");
}
