//web-backend//index.ts

import express from "express";
import cors from "cors";

import { startSpawnSnapshotsRetentionScheduler } from "./routes/adminSpawnPoints";
import { maybeRequireAdmin } from "./middleware/adminAuth";
import adminQuestsRouter from "./routes/adminQuests";
import adminNpcsRouter from "./routes/adminNpcs";
import { adminItemsRouter } from "./routes/adminItems";
import { adminSpellsRouter } from "./routes/adminSpells";
import { adminAbilitiesRouter } from "./routes/adminAbilities";
import { adminAbilityUnlocksRouter } from "./routes/adminAbilityUnlocks";
import adminSpawnPointsRouter from "./routes/adminSpawnPoints";
import { adminVendorAuditRouter } from "./routes/adminVendorAudit";
import { adminVendorEconomyRouter } from "./routes/adminVendorEconomy";
import adminMotherBrainRouter from "./routes/adminMotherBrain";
import adminHeartbeatsRouter from "./routes/adminHeartbeats";
import adminTestFixturesRouter from "./routes/adminTestFixtures";
import { bootstrapWebBackendEnv } from "./bootstrap/env";
import { registerHealthRoutes } from "./server/healthRoutes";
import { mountRouteGroups } from "./server/routeGroups";
import { startServiceHeartbeat } from "./server/heartbeat";

bootstrapWebBackendEnv();

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;

app.use(
  cors({
    origin: "*",
  }),
);
app.use(express.json());

registerHealthRoutes(app);
mountRouteGroups(app);

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
app.use("/api/admin/test_fixtures", maybeRequireAdmin("/api/admin/test_fixtures"), adminTestFixturesRouter);

app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);

  startSpawnSnapshotsRetentionScheduler();
  startServiceHeartbeat({ port: PORT });
});
