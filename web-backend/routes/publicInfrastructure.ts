//web-backend/routes/publicInfrastructure.ts

import { Router } from "express";
import {
  ensurePublicInfrastructureState,
  quotePublicServiceUsage,
  summarizePublicInfrastructure,
  type InfrastructureMode,
  type PublicServiceKind,
} from "../domain/publicInfrastructure";
import { resolvePlayerAccess } from "./playerCityAccess";

const router = Router();

router.get("/status", async (req, res) => {
  const access = await resolvePlayerAccess(req, { requireCity: false });
  if (access.ok === false) {
    return res.json({ ok: true, publicInfrastructure: null, summary: null, quotes: [] });
  }

  const ps = access.access.playerState;
  ensurePublicInfrastructureState(ps);
  const mode = (typeof req.query.serviceMode === "string" && req.query.serviceMode === "npc_public") ? "npc_public" : "private_city";
  const emptyCost = { wealth: 100, materials: 100, mana: 20, knowledge: 40, unity: 10 };
  const services: PublicServiceKind[] = ["building_construct", "building_upgrade", "hero_recruit", "tech_research", "workshop_craft"];
  const quotes = services.map((service) => quotePublicServiceUsage(ps, service, emptyCost, mode as InfrastructureMode));
  const summary = summarizePublicInfrastructure(ps);

  return res.json({
    ok: true,
    publicInfrastructure: ps.publicInfrastructure,
    summary,
    mode,
    quotes,
    cityStress: ps.cityStress,
  });
});

export default router;
