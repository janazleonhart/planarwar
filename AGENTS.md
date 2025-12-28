# AGENTS.md — Planar War MMO

## Project overview

This repo is a custom MMO backend + tools for a game called **Planar War**.

Monorepo layout:

- `worldcore/` — shared game logic (combat, NPCs, AI, movement, quests, mud commands, etc.). Written in TypeScript.
- `mmo-backend/` — authoritative MMO server (WebSocket, sessions, rooms, world ticking). Depends heavily on `worldcore`.
- `web-backend/` — HTTP / API backend for web UI and account stuff.
- `web-frontend/` — React frontend(s).

### Design goals

- Keep `worldcore` **framework-agnostic** and reusable.
- Keep `mmo-backend` focused on networking, ticking, and wiring `worldcore` into a running server.
- Keep `web-backend` + `web-frontend` focused on admin tools and player-facing UI.

When in doubt: prefer small, focused modules over giant files.

## How to behave in this repo

- **Do not invent new technologies**. Stay with the existing stack: Node, TypeScript, React, ws, pg, redis.
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

- TypeScript:
  - Prefer explicit types on public functions and exported helpers.
  - Keep functions relatively small and focused.
  - Avoid introducing any runtime reflection magic or metaprogramming unless asked.
- Logging:
  - Use `Logger.scope("SCOPE")` from `worldcore/utils/logger.ts`.
  - Use `.debug` for noisy, dev-only logs; `.info` for high-level events; `.warn` / `.error` sparingly.
- Error handling:
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

## Safe tasks for Codex

Examples of tasks that are safe and encouraged:

- Split oversized files (like `MudActions.ts`) into smaller modules, updating imports and exports.
- Add unit tests or integration tests for existing systems (combat, NPC AI, movement).
- Add missing type annotations and fix TypeScript errors.
- Implement clearly defined features that touch multiple files (e.g. “make cowardly NPCs actually move when fleeing”).
- Migrate repeated patterns into shared helpers (e.g. repeated combat log patterns, targeting helpers).

When in doubt: propose a small plan in the prompt and follow it step by step.