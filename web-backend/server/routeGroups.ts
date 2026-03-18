//web-backend/server/routeGroups.ts

import type { Express } from "express";
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
import publicInfrastructureRoutes from "../routes/publicInfrastructure";
import cityMudBridgeRoutes from "../routes/cityMudBridge";
import worldConsequencesRoutes from "../routes/worldConsequences";
import { resourceTierRouter } from "../routes/resourceTierRoutes";
import charactersRouter from "../routes/characters";
import authRouter from "../routes/auth";
import spellsRouter from "../routes/spells";
import itemsRouter from "../routes/items";
import abilitiesRouter from "../routes/abilities";

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
  app.use("/api/public_infrastructure", publicInfrastructureRoutes);
  app.use("/api/city_mud_bridge", cityMudBridgeRoutes);
  app.use("/api/world_consequences", worldConsequencesRoutes);
  app.use("/api/resources", resourceTierRouter);
  app.use("/api/characters", charactersRouter);
  app.use("/api/auth", authRouter);
}

export function mountCatalogRoutes(app: Express): void {
  app.use("/api/spells", spellsRouter);
  app.use("/api/items", itemsRouter);
  app.use("/api/abilities", abilitiesRouter);
}

export function mountAdminRoutes(_app: Express): void {
  // Admin routes are mounted explicitly in web-backend/index.ts so structural contract tests
  // can verify the gated app.use(...) declarations at the entrypoint.
}

export function mountRouteGroups(app: Express): void {
  mountPlayerAndDemoRoutes(app);
  mountCatalogRoutes(app);
  mountAdminRoutes(app);
}
