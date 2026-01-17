// worldcore/world/spawnAuthority.ts

export type SpawnAuthority = "anchor" | "seed" | "brain" | "manual";

export function getSpawnAuthority(spawnId: string): SpawnAuthority {
  const raw = String(spawnId ?? "").trim();
  const lower = raw.toLowerCase();

  if (lower.startsWith("anchor:")) return "anchor";
  if (lower.startsWith("seed:")) return "seed";
  if (lower.startsWith("brain:")) return "brain";
  return "manual";
}

export function isSpawnEditable(spawnId: string): boolean {
  // Brain-owned points are read-only from human tools (web editor).
  return getSpawnAuthority(spawnId) !== "brain";
}

export function isSpawnAnchor(spawnId: string): boolean {
  return getSpawnAuthority(spawnId) === "anchor";
}

export function isSpawnSeed(spawnId: string): boolean {
  return getSpawnAuthority(spawnId) === "seed";
}

export function isSpawnBrain(spawnId: string): boolean {
  return getSpawnAuthority(spawnId) === "brain";
}
