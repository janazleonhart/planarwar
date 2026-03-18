//web-backend/routes/cityMudBridge.ts

import { Router } from "express";
import { deriveCityMudConsumers, deriveVendorSupportPolicy, summarizeCityMudBridge } from "../domain/cityMudBridge";
import { applyWorldConsequenceVendorPolicy, deriveWorldConsequenceConsumers } from "../domain/worldConsequenceConsumers";
import { deriveEconomyCartelResponseState } from "../domain/economyCartelResponse";
import { resolvePlayerAccess } from "./playerCityAccess";

const router = Router();

router.get("/status", async (req, res) => {
  const access = await resolvePlayerAccess(req, { requireCity: false });
  if (access.ok === false) {
    return res.json({ ok: true, summary: null });
  }

  const summary = summarizeCityMudBridge(access.access.playerState);
  const consumers = deriveCityMudConsumers(summary);
  const worldConsequenceConsumers = deriveWorldConsequenceConsumers(access.access.playerState);
  const vendorPolicy = deriveVendorSupportPolicy(summary, consumers);
  return res.json({
    ok: true,
    summary,
    consumers,
    vendorPolicy,
    consequenceConsumers: worldConsequenceConsumers,
    economyCartelResponseState: deriveEconomyCartelResponseState(access.access.playerState),
    vendorPolicyWithConsequences: applyWorldConsequenceVendorPolicy(vendorPolicy, worldConsequenceConsumers),
  });
});

export default router;
