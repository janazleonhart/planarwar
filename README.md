# Planar War

Planar War is a multi-service TypeScript project (MMO backend + world simulation + admin web tooling) built as an npm workspaces monorepo.

## Repo Layout

- `worldcore/`  
  Core world simulation, rules, domain models, tools, and tests.

- `mmo-backend/`  
  WebSocket shard server (runtime server).

- `web-backend/`  
  Express API for web/admin tooling (spawns, control panels, etc).

- `web-frontend/`  
  Vite + React admin UI.

- `.github/`  
  CI workflows and repo guard rails.

## Quickstart (common)

Install deps:
npm ci

Dev servers:
PW_SERVICE_RADIUS=12 PW_WALKTO_MAX_STEPS=160 PW_TOWN_BASELINES=1 PW_SERVICE_GATES=1 WORLD_SPAWNS_ENABLED=1 WORLD_NPC_SPAWNS_ENABLED=1 
WORLD_NPC_SPAWN_RADIUS=120 PW_CRAFT_STATIONS_REQUIRED=1 PW_FILELOG=logs/planarwar-{scope}.log npm run dev:mmo
npm run dev:web-backend
npm run dev:web-frontend

WorldCore build + tests:
npm run build --workspace worldcore
npm run test  --workspace worldcore

WorldCore sim tool:
npm run sim:brain --workspace worldcore -- <args>
Registry System (how to navigate the codebase)
This repo uses registries to describe what files/modules do (purpose, service role, dependencies, etc).

Start here:

RegistryIndex.json — master index that points to per-package registries

Per-package registries:

WorldCoreRegistry.json

mmo-backend/MmoBackendRegistry.json

web-backend/WebBackendRegistry.json

web-frontend/WebFrontendRegistry.json

.github/GithubRegistry.json

These registries are intended to be updated at the end of each meaningful handoff so they remain authoritative.

CI Guard Rails
registry-check (WorldCore registry drift guard)
Ensures WorldCoreRegistry.json stays in sync with worldcore/**.

registry-index-paths-check (RegistryIndex + paths validation)
Ensures registry files parse and every registry entry path actually exists.

