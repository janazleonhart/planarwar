//web-backend//index.ts

import express from "express";
import requireAdmin, { maybeRequireAdmin } from "./middleware/adminAuth";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

import meRouter from "./routes/me";
import missionsRouter from "./routes/missions";
import cityRouter from "./routes/city";
import policiesRouter from "./routes/policies";
import techRouter from "./routes/tech";
import warfrontRoutes from "./routes/warfront";
import armiesRoutes from "./routes/armies";
import garrisonsRoutes from "./routes/garrisons";
import buildingsRoutes from "./routes/buildings";
import heroesRoutes from "./routes/heroes";
import workshopRoutes from "./routes/workshop";
import { resourceTierRouter } from "./routes/resourceTierRoutes";
import charactersRouter from "./routes/characters";
import authRouter from "./routes/auth";
import adminQuestsRouter from "./routes/adminQuests";
import adminNpcsRouter from "./routes/adminNpcs";
import { adminItemsRouter } from "./routes/adminItems";
import { adminSpellsRouter } from "./routes/adminSpells";
import { adminAbilitiesRouter } from "./routes/adminAbilities";
import { adminAbilityUnlocksRouter } from "./routes/adminAbilityUnlocks";
import adminSpawnPointsRouter, { startSpawnSnapshotsRetentionScheduler } from "./routes/adminSpawnPoints";
import { adminVendorAuditRouter } from "./routes/adminVendorAudit";
import { adminVendorEconomyRouter } from "./routes/adminVendorEconomy";
import adminMotherBrainRouter from "./routes/adminMotherBrain";
import adminHeartbeatsRouter from "./routes/adminHeartbeats";
import spellsRouter from "./routes/spells";
import itemsRouter from "./routes/items";
import abilitiesRouter from "./routes/abilities";

function tryLoadDotEnv(): void {
  const candidates = new Set<string>();

  // 1) cwd search upward (works for workspace + repo-root starts)
  let cur = process.cwd();
  for (let i = 0; i < 6; i++) {
    candidates.add(path.join(cur, ".env"));
    candidates.add(path.join(cur, ".env.local"));
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }

  // 2) __dirname search upward (works when cwd is unexpected)
  cur = __dirname;
  for (let i = 0; i < 6; i++) {
    candidates.add(path.join(cur, ".env"));
    candidates.add(path.join(cur, ".env.local"));
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        dotenv.config({ path: p });
        // eslint-disable-next-line no-console
        console.log(`[web-backend] loaded env: ${p}`);
        return;
      }
    } catch {
      // ignore
    }
  }

  // Final fallback: default dotenv behavior (cwd)
  dotenv.config();
}

function bridgePlanarWarDbEnv(): void {
  const hasUrl =
    !!process.env.PW_DATABASE_URL ||
    !!process.env.DATABASE_URL ||
    !!process.env.POSTGRES_URL ||
    !!process.env.PG_URL;

  // If already configured, no work.
  if (hasUrl) return;

  const host = process.env.PW_DB_HOST;
  const port = process.env.PW_DB_PORT;
  const user = process.env.PW_DB_USER;
  const pass = process.env.PW_DB_PASS;
  const name = process.env.PW_DB_NAME;

  // If the Planar War vars aren't set, nothing to bridge.
  if (!host || !user || !name) return;

  // Also set PG* vars so any pg Pool(new Pool()) works automatically.
  if (!process.env.PGHOST) process.env.PGHOST = host;
  if (!process.env.PGPORT && port) process.env.PGPORT = port;
  if (!process.env.PGUSER) process.env.PGUSER = user;
  if (!process.env.PGDATABASE) process.env.PGDATABASE = name;
  if (!process.env.PGPASSWORD && pass) process.env.PGPASSWORD = pass;

  // Build a connection string for routes that prefer DATABASE_URL.
  // NOTE: omit password segment if blank.
  const encUser = encodeURIComponent(user);
  const encPass = pass ? encodeURIComponent(pass) : "";
  const safePort = port ? String(port) : "5432";

  const auth = encPass ? `${encUser}:${encPass}` : encUser;
  const url = `postgresql://${auth}@${host}:${safePort}/${name}`;

  if (!process.env.PW_DATABASE_URL) process.env.PW_DATABASE_URL = url;
  if (!process.env.DATABASE_URL) process.env.DATABASE_URL = url;
}

tryLoadDotEnv();
bridgePlanarWarDbEnv();

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;

app.use(
  cors({
    origin: "*",
  }),
);
app.use(express.json());

app.get("/", (_req, res) => {
  res.json({ ok: true, message: "Planar War – Web backend online." });
});

app.get("/api/healthz", (_req, res) => {
  res.json({
    ok: true,
    service: "web-backend",
    pid: process.pid,
    uptimeMs: Math.floor(process.uptime() * 1000),
    now: new Date().toISOString(),
  });
});

// "Ready" means: basic env is present for DB-backed routes.
// We don't hard-require DB connectivity here because dev/prod might bring DB up after the service.
// (Systemd can use this endpoint as a lightweight readiness hint.)
app.get("/api/readyz", (_req, res) => {
  const hasDbUrl =
    !!process.env.PW_DATABASE_URL ||
    !!process.env.DATABASE_URL ||
    !!process.env.POSTGRES_URL ||
    !!process.env.PG_URL;

  const hasDbParts = !!process.env.PW_DB_HOST && !!process.env.PW_DB_USER && !!process.env.PW_DB_NAME;

  const ready = hasDbUrl || hasDbParts;

  const payload = {
    ok: ready,
    service: "web-backend",
    ready,
    db: {
      configured: ready,
      hasDbUrl,
      hasDbParts,
    },
    now: new Date().toISOString(),
  };

  if (ready) res.json(payload);
  else res.status(503).json(payload);
});


app.use("/api/me", meRouter);
app.use("/api/missions", missionsRouter);
app.use("/api/city", cityRouter);
app.use("/api/policies", policiesRouter);
app.use("/api/tech", techRouter);
app.use("/api/warfront", warfrontRoutes);
app.use("/api/armies", armiesRoutes);
app.use("/api/garrisons", garrisonsRoutes);
app.use("/api/buildings", buildingsRoutes);
app.use("/api/heroes", heroesRoutes);
app.use("/api/workshop", workshopRoutes);
app.use("/api/resources", resourceTierRouter);
app.use("/api/characters", charactersRouter);
app.use("/api/auth", authRouter);

// UI meta endpoints
app.use("/api/spells", spellsRouter);
app.use("/api/items", itemsRouter);
app.use("/api/abilities", abilitiesRouter);

app.use("/api/admin/quests", maybeRequireAdmin("/api/admin/quests"), adminQuestsRouter);
app.use("/api/admin/npcs", maybeRequireAdmin("/api/admin/npcs"), adminNpcsRouter);
app.use("/api/admin/items", maybeRequireAdmin("/api/admin/items"), adminItemsRouter);
app.use("/api/admin/spells", maybeRequireAdmin("/api/admin/spells"), adminSpellsRouter);
app.use("/api/admin/abilities", maybeRequireAdmin("/api/admin/abilities"), adminAbilitiesRouter);
app.use("/api/admin/ability_unlocks", maybeRequireAdmin("/api/admin/ability_unlocks"), adminAbilityUnlocksRouter);
app.use("/api/admin/spawn_points", maybeRequireAdmin("/api/admin/spawn_points"), adminSpawnPointsRouter);
app.use("/api/admin/vendor_audit", maybeRequireAdmin("/api/admin/vendor_audit"), adminVendorAuditRouter);
app.use("/api/admin/vendor_economy", maybeRequireAdmin("/api/admin/vendor_economy"), adminVendorEconomyRouter);
app.use("/api/admin/mother_brain", maybeRequireAdmin("/api/admin/mother_brain"), adminMotherBrainRouter);
app.use("/api/admin/heartbeats", maybeRequireAdmin("/api/admin/heartbeats"), adminHeartbeatsRouter);

app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
  // Optional background hygiene: spawn snapshot retention (disabled by default; see env vars).
  startSpawnSnapshotsRetentionScheduler();
});
