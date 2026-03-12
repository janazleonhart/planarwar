//web-backend/routes/policies.ts

import { Router } from "express";

import { tickPlayerState } from "../gameState";
import { withPlayerAccessMutation } from "./playerCityAccess";

const router = Router();

router.get("/", async (req, res) => {
  const access = await withPlayerAccessMutation(
    req,
    (access) => {
      tickPlayerState(access.playerState, new Date());
      return {
        policies: access.playerState.policies,
        cityStress: access.playerState.cityStress,
        resources: access.playerState.resources,
      };
    },
    { requireCity: true },
  );

  if (access.ok === false) {
    return res.status(access.status).json({ error: access.error });
  }

  return res.json(access.value);
});

router.post("/toggle", async (req, res) => {
  const { key, value } = req.body ?? {};

  if (typeof key !== "string" || typeof value !== "boolean") {
    return res.status(400).json({ error: "key (string) and value (boolean) are required" });
  }

  const access = await withPlayerAccessMutation(
    req,
    (access) => {
      const ps = access.playerState;
      if (!(key in ps.policies)) {
        return { ok: false as const, code: 400, body: { error: `Unknown policy: ${key}` } };
      }

      const policyKey = key as keyof typeof ps.policies;
        ps.policies[policyKey] = value;
      return { ok: true as const, body: { ok: true, policies: ps.policies } };
    },
    { requireCity: true },
  );

  if (access.ok === false) {
    return res.status(access.status).json({ error: access.error });
  }

  if (access.value.ok === false) {
    return res.status(access.value.code).json(access.value.body);
  }

  return res.json(access.value.body);
});

export default router;
