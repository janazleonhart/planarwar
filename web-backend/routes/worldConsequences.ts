//web-backend/routes/worldConsequences.ts

import { Router } from "express";
import { summarizePlayerWorldConsequences } from "../gameState";
import { deriveWorldConsequenceHooks } from "../domain/worldConsequenceHooks";
import { deriveWorldConsequenceActions } from "../domain/worldConsequenceActions";
import { applyWorldConsequenceVendorPolicy, deriveWorldConsequenceConsumers } from "../domain/worldConsequenceConsumers";
import { deriveCityMudConsumers, deriveVendorSupportPolicy, summarizeCityMudBridge } from "../domain/cityMudBridge";
import { resolvePlayerAccess } from "./playerCityAccess";

const router = Router();

router.get("/status", async (req, res) => {
  const access = await resolvePlayerAccess(req, { requireCity: false });
  if (access.ok === false) {
    return res.json({ ok: true, summary: null, ledger: [], propagatedState: null });
  }

  const bridgeSummary = summarizeCityMudBridge(access.access.playerState);
  const bridgeConsumers = deriveCityMudConsumers(bridgeSummary);
  const vendorPolicy = deriveVendorSupportPolicy(bridgeSummary, bridgeConsumers);
  const consequenceConsumers = deriveWorldConsequenceConsumers(access.access.playerState);
  return res.json({
    ok: true,
    summary: summarizePlayerWorldConsequences(access.access.playerState),
    ledger: access.access.playerState.worldConsequences ?? [],
    propagatedState: access.access.playerState.worldConsequenceState ?? null,
    hooks: deriveWorldConsequenceHooks(access.access.playerState),
    actions: deriveWorldConsequenceActions(access.access.playerState),
    consumers: consequenceConsumers,
    consumerTargets: {
      vendorPolicy,
      vendorPolicyWithConsequences: applyWorldConsequenceVendorPolicy(vendorPolicy, consequenceConsumers),
      bridgeSummary,
    },
  });
});

router.get("/actions", async (req, res) => {
  const access = await resolvePlayerAccess(req, { requireCity: false });
  if (access.ok === false) {
    return res.json({ ok: true, actions: null });
  }

  return res.json({
    ok: true,
    actions: deriveWorldConsequenceActions(access.access.playerState),
  });
});

router.get("/consumers", async (req, res) => {
  const access = await resolvePlayerAccess(req, { requireCity: false });
  if (access.ok === false) {
    return res.json({ ok: true, consumers: null });
  }
  const bridgeSummary = summarizeCityMudBridge(access.access.playerState);
  const bridgeConsumers = deriveCityMudConsumers(bridgeSummary);
  const vendorPolicy = deriveVendorSupportPolicy(bridgeSummary, bridgeConsumers);
  const consumers = deriveWorldConsequenceConsumers(access.access.playerState);
  return res.json({
    ok: true,
    consumers,
    consumerTargets: {
      vendorPolicy,
      vendorPolicyWithConsequences: applyWorldConsequenceVendorPolicy(vendorPolicy, consumers),
      bridgeSummary,
    },
  });
});

router.get("/hooks", async (req, res) => {
  const access = await resolvePlayerAccess(req, { requireCity: false });
  if (access.ok === false) {
    return res.json({ ok: true, hooks: null });
  }

  return res.json({
    ok: true,
    hooks: deriveWorldConsequenceHooks(access.access.playerState),
    actions: deriveWorldConsequenceActions(access.access.playerState),
  });
});

export default router;
