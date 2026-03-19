//web-backend/routes/worldConsequences.ts

import { Router } from "express";
import { summarizePlayerWorldConsequences } from "../gameState";
import { deriveWorldConsequenceHooks } from "../domain/worldConsequenceHooks";
import { deriveWorldConsequenceActions } from "../domain/worldConsequenceActions";
import { applyWorldConsequenceVendorPolicy, deriveWorldConsequenceConsumers } from "../domain/worldConsequenceConsumers";
import { deriveEconomyCartelResponseState } from "../domain/economyCartelResponse";
import { deriveCityMudConsumers, deriveVendorSupportPolicy, summarizeCityMudBridge } from "../domain/cityMudBridge";
import { resolvePlayerAccess, withPlayerAccessMutation } from "./playerCityAccess";
import { executeWorldConsequenceAction } from "../domain/worldConsequenceRuntimeActions";
import { summarizeWorldConsequenceResponseReceipts } from "../domain/worldConsequences";

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
    responseState: deriveEconomyCartelResponseState(access.access.playerState),
    actions: deriveWorldConsequenceActions(access.access.playerState),
    responseReceipts: summarizeWorldConsequenceResponseReceipts(access.access.playerState.worldConsequences ?? []),
    consumers: consequenceConsumers,
    consumerTargets: {
      vendorPolicy,
      vendorPolicyWithConsequences: applyWorldConsequenceVendorPolicy(vendorPolicy, consequenceConsumers),
      bridgeSummary,
    },
  });
});


router.post("/act", async (req, res) => {
  const actionId = typeof req.body?.actionId === "string" ? req.body.actionId.trim() : "";
  if (!actionId) {
    return res.status(400).json({ ok: false, error: "actionId is required" });
  }

  const access = await withPlayerAccessMutation(req, (access) => {
    const result = executeWorldConsequenceAction(access.playerState, actionId);
    if (!result.ok) {
      const code = result.status === "unknown_action" ? 404 : 400;
      return {
        ok: false as const,
        code,
        body: {
          ok: false,
          error: result.message,
          status: result.status,
          actionId,
          result,
          resources: access.playerState.resources,
          worldConsequenceActions: deriveWorldConsequenceActions(access.playerState),
          worldConsequenceResponseReceipts: summarizeWorldConsequenceResponseReceipts(access.playerState.worldConsequences ?? []),
        },
      };
    }

    const bridgeSummary = summarizeCityMudBridge(access.playerState);
    const bridgeConsumers = deriveCityMudConsumers(bridgeSummary);
    const vendorPolicy = deriveVendorSupportPolicy(bridgeSummary, bridgeConsumers);
    const consumers = deriveWorldConsequenceConsumers(access.playerState);

    return {
      ok: true as const,
      body: {
        ok: true,
        result,
        resources: access.playerState.resources,
        cityStress: access.playerState.cityStress,
        worldConsequenceState: access.playerState.worldConsequenceState ?? null,
        worldConsequences: access.playerState.worldConsequences ?? [],
        worldConsequenceHooks: deriveWorldConsequenceHooks(access.playerState),
        worldConsequenceActions: deriveWorldConsequenceActions(access.playerState),
        worldConsequenceResponseReceipts: summarizeWorldConsequenceResponseReceipts(access.playerState.worldConsequences ?? []),
        worldConsequenceConsumers: consumers,
        responseState: deriveEconomyCartelResponseState(access.playerState),
        consumerTargets: {
          vendorPolicy,
          vendorPolicyWithConsequences: applyWorldConsequenceVendorPolicy(vendorPolicy, consumers),
          bridgeSummary,
        },
      },
    };
  });

  if (access.ok === false) return res.status(access.status).json({ ok: false, error: access.error });
  if (!access.value.ok) return res.status(access.value.code).json(access.value.body);
  return res.json(access.value.body);
});

router.get("/actions", async (req, res) => {
  const access = await resolvePlayerAccess(req, { requireCity: false });
  if (access.ok === false) {
    return res.json({ ok: true, actions: null });
  }

  return res.json({
    ok: true,
    actions: deriveWorldConsequenceActions(access.access.playerState),
    responseReceipts: summarizeWorldConsequenceResponseReceipts(access.access.playerState.worldConsequences ?? []),
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
    responseState: deriveEconomyCartelResponseState(access.access.playerState),
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
    responseState: deriveEconomyCartelResponseState(access.access.playerState),
    actions: deriveWorldConsequenceActions(access.access.playerState),
    responseReceipts: summarizeWorldConsequenceResponseReceipts(access.access.playerState.worldConsequences ?? []),
  });
});

export default router;
