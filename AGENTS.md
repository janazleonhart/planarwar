# AGENTS.md — Planar War MMO

## Project overview

This repo is a custom MMO backend + tools for a game called **Planar War**.

Monorepo layout:

- `worldcore/` — shared game logic (combat, NPCs, AI, movement, quests, MUD commands, etc.). Written in TypeScript.
- `mmo-backend/` — authoritative MMO server (WebSocket, sessions, rooms, world ticking). Depends heavily on `worldcore`.
- `web-backend/` — HTTP / API backend for web UI and account stuff.
- `web-frontend/` — React frontend(s).

### Design goals

- Keep `worldcore` **framework-agnostic** and reusable.
- Keep `mmo-backend` focused on networking, ticking, and wiring `worldcore` into a running server.
- Keep `web-backend` + `web-frontend` focused on admin tools and player-facing UI.
- When in doubt: prefer small, focused modules over giant files.

## How to behave in this repo

- **Do not invent new technologies.** Stay with the existing stack: Node, TypeScript, React, `ws`, `pg`, `redis`.
- **Prefer refactors over rewrites.** Preserve existing APIs where possible, or clearly mark breaking changes.
- **Keep logs and debug output lightweight.** Avoid adding heavy logging in hot paths (tick loops, combat calculation) unless explicitly asked, and prefer existing `Logger.scope(...)` usage.
- **Respect layering:**
  - `worldcore` never owns HTTP/WebSocket lifecycle.
  - `mmo-backend` should consume `worldcore` via exported services (e.g. `createWorldServices`), not by re-implementing wiring.

## Building and testing

Before making non-trivial changes:

1. Inspect `package.json` in each workspace (`worldcore`, `mmo-backend`, `web-backend`, `web-frontend`) to see what scripts exist.
2. Prefer running existing npm scripts (e.g. `npm run build`, `npm test`) instead of inventing new ones.
3. At minimum, after edits in a workspace:
   - Run TypeScript checks with the configured script or `tsc -p tsconfig.json` for that workspace.
   - Fix any type errors you introduce.

When you add new behavior in `worldcore`, prefer **unit or integration tests** under `worldcore/test` that exercise the new flow end-to-end instead of only testing small helpers.

## Coding style

- **TypeScript**
  - Prefer explicit types on public functions and exported helpers.
  - Keep functions relatively small and focused.
  - Avoid introducing runtime reflection magic or metaprogramming unless asked.
- **Logging**
  - Use `Logger.scope("SCOPE")` from `worldcore/utils/logger.ts`.
  - Use `.debug` for noisy, dev-only logs; `.info` for high-level events; `.warn` / `.error` sparingly.
- **Error handling**
  - Avoid crashing the server for bad player input; return clean error paths instead.

## Worldcore structure (important areas)

- `worldcore/mud/` — text MUD interface (commands, handlers, actions).
- `worldcore/combat/` — combat flow, damage calculation, cooldowns.
- `worldcore/npc/` + `worldcore/ai/` — NPC definitions, brain logic, aggro/flee behavior.
- `worldcore/world/` — regions, respawn, world manager, world services.
- `worldcore/core/` — shared core systems (tick engine, movement engine, rooms, sessions).
- `worldcore/songs/` — SongEngine, Virtuoso melody behavior.
- `worldcore/progression/` — progression events, tasks, titles, rewards.

When changing code in these areas:

- Keep behavior consistent with existing commands and flows unless the prompt explicitly asks to change it.
- If you split a large file (e.g. `MudActions.ts`), update all imports and keep backwards-compatible exports where possible.

## WorldCoreRegistry.json (authoritative map for worldcore)

- There is a `WorldCoreRegistry.json` file in the **root of the `worldcore/` package**.
- It currently describes **only modules under `worldcore/**`** (not `mmo-backend`, `web-backend`, or `web-frontend`).
- Each entry maps a logical id (like `"combat.engine"`) to:
  - `path`: the canonical TypeScript file under `worldcore/`.
  - `kind`: rough role (`service`, `model`, `utility`, `config`, etc.).
  - Optional `functions` / `class`: expected public API.
  - Optional `dependsOn`: other logical ids this module is allowed to depend on.
  - Optional `notes`: description of what the module does.

When working on `worldcore` code:

- Prefer imports that match the `path` in `WorldCoreRegistry.json`.
- Keep dependencies consistent with `dependsOn` where possible.
- If you add a new service/module under `worldcore`, update `WorldCoreRegistry.json` with a new entry.
- Avoid touching non-`worldcore` code in the same refactor unless the prompt explicitly includes it.
- For **large refactors** (rewiring `WorldServices`, `MudContext`, `ServerWorldManager`, etc.):
  - Treat `WorldCoreRegistry.json` as the **source of truth** for which services exist and how they relate.
  - Favor constructor-injected services over hidden singletons or random imports.

Do not change the **schema or semantics** of `WorldCoreRegistry.json` in automated refactors unless explicitly instructed.

## Combat & NPC damage plumbing (worldcore invariants)

**Important invariants:**

- Whenever code applies damage on behalf of a **player character** to an NPC via `NpcManager.applyDamage`, it MUST include the `CharacterState` in the attacker info:

  ```ts
  npcManager.applyDamage(npcId, amount, {
    entityId: playerEntityId,
    character: playerChar, // required for crime + threat
  });

Never call NpcManager.applyDamage with only entityId for player-origin attacks. Doing so will bypass:
Crime tracking (recordNpcCrimeAgainst).
Guard AI responses.
Any future systems that inspect recentCrimeUntil / recentCrimeSeverity.

Integration tests that exercise guard / crime behavior should prefer:
Calling NpcCombat.performNpcAttack(...), or
Explicitly passing a real CharacterState into NpcManager.applyDamage(...).
At least one test in worldcore/test should:
Attack a protected NPC via NpcCombat.performNpcAttack(...), and
Assert that the attacker’s CharacterState gets recentCrimeUntil (and/or similar crime flags) set.

SongEngine / TickEngine melody integration (worldcore + mmo-backend)
Virtuoso melody is driven server-side via TickEngine and the SongEngine tick.

Key contracts:

worldcore/world/WorldServices.ts:
Exposes WorldServicesOptions with:
seed?: number
tickIntervalMs?: number
onTick?: (nowMs: number, tick: number, deltaMs?: number) => void

Constructs a TickEngine with:
const ticks = new TickEngine(
  entities,
  rooms,
  sessions,
  world,
  {
    intervalMs: tickIntervalMs,
    onTick: options.onTick,
  },
  npcs
);

mmo-backend/server.ts:
Calls createWorldServices(worldOptions) where worldOptions.onTick runs the Virtuoso song tick over active sessions using tickSongsForCharacter.
Uses setMelodyActive to stop melody cleanly on:
Character attach (to avoid carrying over stale melody state).
Socket close / disconnect.

worldcore/songs/SongEngine.ts:
tickSongsForCharacter(ctx, char, nowMs):
Reads the canonical melody from progression (getMelody(char)).
Uses melody.spellIds, melody.isActive, melody.intervalMs.
Calls castSpellForCharacter for each song in the playlist.
Advances melody.currentIndex and updates melody.nextCastAtMs.

setMelodyActive(char, boolean):
Controls whether melody is ticking at all.

Do not:
Rename or change the signature of tickSongsForCharacter or setMelodyActive in automated refactors.
Remove or bypass the WorldServicesOptions.onTick wiring or the TickEngine configuration that forwards onTick.
Reintroduce direct char.melody poking; melody state must come from progression helpers (getMelody / setMelodyActive).

Protected systems (do-not-touch areas for automated refactors)
The following paths are considered critical and must not be modified
by automated refactors unless the task explicitly says otherwise:

worldcore/world/WorldServices.ts:
WorldServicesOptions.onTick.
TickEngine construction and onTick wiring.
Creation and exposure of NpcSpawnController as npcSpawns.

worldcore/songs/SongEngine.ts:
tickSongsForCharacter.
setMelodyActive and getMelody usage.

mmo-backend/server.ts:
The SongEngine tick hook passed via WorldServicesOptions.onTick.
The attach/disconnect logic that uses setMelodyActive to stop melody.

Codex / automated agents should avoid touching these areas except when the goal of the task is specifically to change SongEngine or TickEngine behavior and the prompt explicitly authorizes it.

Suggested tests and invariants for agents
When you add or refactor systems, you should either:

Extend existing tests, or
Add new tests under worldcore/test or mmo-backend/test that cover these invariants.

Recommended coverage:
NPC crime & guards
Use NpcCombat.performNpcAttack against a protected NPC.

Assert:
Crime state on the attacker’s CharacterState (e.g. recentCrimeUntil).
Guard AI reacts (where practical in an integration test).

Virtuoso melody tick
Create a fake MudContext and CharacterState for a Virtuoso with:
melody.isActive = true.
melody.spellIds containing at least one valid song.

Call tickSongsForCharacter:
Assert that it returns a non-empty message when appropriate.
Assert that melody.currentIndex and melody.nextCastAtMs update as expected.
NpcSpawnController personal nodes
Seed a region with a personal node spawn point.
Call the personal spawn path used by the MMO server.

Assert that:
A node entity is spawned for the correct owner.
Repeat calls do not create duplicate nodes for the same owner/point.
Movement bounds
Use MovementEngine and world boundaries from WorldServices.
Attempt to move entities beyond the world boundary.
Assert that movement is clamped or rejected according to the current configuration.
World bootstrap
Instantiate createWorldServices with a fixed seed.

Assert that:
Required services (sessions, entities, rooms, world, navGrid, npcs, npcSpawns, ticks, etc.) are non-null.
items.loadAll() failures are logged but do not crash the bootstrap.
Agents should prefer integration-style tests that exercise real flows (combat, NPC AI, melody, movement) instead of only testing private helpers in isolation.