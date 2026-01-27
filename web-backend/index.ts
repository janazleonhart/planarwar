//web-backend//index.ts

import express from "express";
import requireAdmin, { maybeRequireAdmin } from "./middleware/adminAuth";
import cors from "cors";
import dotenv from "dotenv";

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
import adminItemsRouter from "./routes/adminItems";
import adminSpawnPointsRouter from "./routes/adminSpawnPoints";
import { adminVendorAuditRouter } from "./routes/adminVendorAudit";
import { adminVendorEconomyRouter } from "./routes/adminVendorEconomy";
import spellsRouter from "./routes/spells";
import itemsRouter from "./routes/items";
import abilitiesRouter from "./routes/abilities";

dotenv.config();

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
app.use("/api/admin/spawn_points", maybeRequireAdmin("/api/admin/spawn_points"), adminSpawnPointsRouter);
app.use("/api/admin/vendor_audit", maybeRequireAdmin("/api/admin/vendor_audit"), adminVendorAuditRouter);
app.use("/api/admin/vendor_economy", maybeRequireAdmin("/api/admin/vendor_economy"), adminVendorEconomyRouter);

app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
});