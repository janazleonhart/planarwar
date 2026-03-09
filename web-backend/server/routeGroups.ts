//web-backend/server/routeGroups.ts

import type { Express } from "express";
import { maybeRequireAdmin } from "../middleware/adminAuth";

import meRouter from "../routes/me";
import missionsRouter from "../routes/missions";
import cityRouter from "../routes/city";
import policiesRouter from "../routes/policies";
import techRouter from "../routes/tech";
import warfrontRoutes from "../routes/warfront";
import armiesRoutes from "../routes/armies";
import garrisonsRoutes from "../routes/garrisons";
import buildingsRoutes from "../routes/buildings";
import heroesRoutes from "../routes/heroes";
import workshopRoutes from "../routes/workshop";
import { resourceTierRouter } from "../routes/resourceTierRoutes";
import charactersRouter from "../routes/characters";
import authRouter from "../routes/auth";
import spellsRouter from "../routes/spells";
import itemsRouter from "../routes/items";
import abilitiesRouter from "../routes/abilities";
import adminQuestsRouter from "../routes/adminQuests";
import adminNpcsRouter from "../routes/adminNpcs";
import { adminItemsRouter } from "../routes/adminItems";
import { adminSpellsRouter } from "../routes/adminSpells";
import { adminAbilitiesRouter } from "../routes/adminAbilities";
import { adminAbilityUnlocksRouter } from "../routes/adminAbilityUnlocks";
import adminSpawnPointsRouter from "../routes/adminSpawnPoints";
import { adminVendorAuditRouter } from "../routes/adminVendorAudit";
import { adminVendorEconomyRouter } from "../routes/adminVendorEconomy";
import adminMotherBrainRouter from "../routes/adminMotherBrain";
import adminHeartbeatsRouter from "../routes/adminHeartbeats";
import adminTestFixturesRouter from "../routes/adminTestFixtures";

export function mountPlayerAndDemoRoutes(app: Express): void {
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
}

export function mountCatalogRoutes(app: Express): void {
  app.use("/api/spells", spellsRouter);
  app.use("/api/items", itemsRouter);
  app.use("/api/abilities", abilitiesRouter);
}

export function mountAdminRoutes(app: Express): void {
  app.use("/api/admin/quests", maybeRequireAdmin("/api/admin/quests"), adminQuestsRouter);
  app.use("/api/admin/npcs", maybeRequireAdmin("/api/admin/npcs"), adminNpcsRouter);
  app.use("/api/admin/items", maybeRequireAdmin("/api/admin/items"), adminItemsRouter);
  app.use("/api/admin/spells", maybeRequireAdmin("/api/admin/spells"), adminSpellsRouter);
  app.use("/api/admin/abilities", maybeRequireAdmin("/api/admin/abilities"), adminAbilitiesRouter);
  app.use(
    "/api/admin/ability_unlocks",
    maybeRequireAdmin("/api/admin/ability_unlocks"),
    adminAbilityUnlocksRouter,
  );
  app.use("/api/admin/spawn_points", maybeRequireAdmin("/api/admin/spawn_points"), adminSpawnPointsRouter);
  app.use("/api/admin/vendor_audit", maybeRequireAdmin("/api/admin/vendor_audit"), adminVendorAuditRouter);
  app.use(
    "/api/admin/vendor_economy",
    maybeRequireAdmin("/api/admin/vendor_economy"),
    adminVendorEconomyRouter,
  );
  app.use("/api/admin/mother_brain", maybeRequireAdmin("/api/admin/mother_brain"), adminMotherBrainRouter);
  app.use("/api/admin/heartbeats", maybeRequireAdmin("/api/admin/heartbeats"), adminHeartbeatsRouter);
  app.use(
    "/api/admin/test_fixtures",
    maybeRequireAdmin("/api/admin/test_fixtures"),
    adminTestFixturesRouter,
  );
}

export function mountRouteGroups(app: Express): void {
  mountPlayerAndDemoRoutes(app);
  mountCatalogRoutes(app);
  mountAdminRoutes(app);
}
