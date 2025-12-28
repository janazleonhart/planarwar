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

## Building and testing

Before making non-trivial changes:

1. Inspect `package.json` in each workspace (`worldcore`, `mmo-backend`, `web-backend`, `web-frontend`) to see what scripts exist.
2. Prefer running existing npm scripts (e.g. `npm run build`, `npm test`) instead of inventing new ones.
3. At minimum, after edits in a workspace:
   - Run TypeScript checks with the configured script or `tsc -p tsconfig.json` for that workspace.
   - Fix any type errors you introduce.

If you’re unsure whether a script exists, **check the file** instead of guessing.

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
- `worldcore/world/` — regions, respawn, world manager.
- `worldcore/core/` — shared core systems (tick engine, movement engine, rooms, sessions).

When changing code in these areas:

- Keep behavior consistent with existing commands and flows unless the prompt explicitly asks to change it.
- If you split a large file (e.g. `MudActions.ts`), update all imports and keep backwards-compatible exports where possible.

## Worldcore registry (important for agents)

- There is a `WorldCoreRegistry.json` file in the `worldcore/` directory (the root of the worldcore package).
- It currently describes **only modules under `worldcore/**`**.
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

For large refactors (for example, rewiring `WorldServices`, `MudContext`, or `ServerWorldManager`):

- Use `WorldCoreRegistry.json` as the **source of truth** for which services exist and how they relate.
- Favor constructor-injected services over hidden singletons or random imports.

## Combat & NPC damage plumbing (worldcore)

**Important invariants:**

- Whenever code applies damage on behalf of a **player character** to an NPC via `NpcManager.applyDamage`, it MUST include the `CharacterState` in the attacker info:

  ```ts
  npcManager.applyDamage(npcId, amount, {
    entityId: playerEntityId,
    character: playerChar, // required for crime + threat
  });
Never call NpcManager.applyDamage with only entityId for player-origin attacks. That will bypass:

crime tracking (recordNpcCrimeAgainst),

guard AI responses,

any future systems that inspect recentCrimeUntil / recentCrimeSeverity.

Integration tests that exercise guard / crime behavior should prefer:

calling NpcCombat.performNpcAttack(...), or

explicitly passing a real CharacterState into NpcManager.applyDamage(...).

At least one test in worldcore/test must:

attack a protected NPC via NpcCombat.performNpcAttack, and

assert that the attacker’s CharacterState gets recentCrimeUntil set.