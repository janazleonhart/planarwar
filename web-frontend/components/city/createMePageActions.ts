// web-frontend/components/city/createMePageActions.ts

import type { Dispatch, SetStateAction } from "react";
import {
  api,
  ApiResponseError,
  bootstrapCity,
  completeMission,
  executeWorldConsequenceAction,
  renameCity,
  startMission,
  startTech,
  type AppliedPublicServiceUsage,
  type ArmyType,
  type CityBuilding,
  type HeroRole,
  type InfrastructureMode,
  type MeProfile,
  type Resources,
  type SettlementOpeningOperation,
  type WorldConsequenceActionItem,
} from "../../lib/api";
import {
  formatWorldActionCooldown,
  formatWorldActionCost,
  formatWorldDelta,
} from "../worldResponse/worldResponseUi";
import { summarizeUsage } from "./CityUiHelpers";
import type { OpeningActionReceipt } from "./useMePageController";

export type MePageFlashSetter = (kind: "ok" | "err", text: string) => void;

export type CreateMePageActionsArgs = {
  busyAction: string | null;
  cityNameDraft: string;
  citySetupLane: "city" | "black_market";
  me: MeProfile | null;
  refreshMe: (mode?: InfrastructureMode) => Promise<MeProfile | null>;
  serviceMode: InfrastructureMode;
  setBusyAction: (value: string | null) => void;
  setError: (value: string | null) => void;
  setFlash: MePageFlashSetter;
  setWorldActionBusyId: (value: string | null) => void;
  setOpeningActionReceipts: Dispatch<SetStateAction<OpeningActionReceipt[]>>;
  worldActionBusyId: string | null;
};

type ActionSuccessSummary = {
  detail?: string | null;
  impactSummary?: string | null;
  outcome?: OpeningActionReceipt["outcome"];
};

function getOpeningOperationReceiptKey(operation: SettlementOpeningOperation): string {
  return operation.id;
}

export function createMePageActions({
  busyAction,
  cityNameDraft,
  citySetupLane,
  me,
  refreshMe,
  serviceMode,
  setBusyAction,
  setError,
  setFlash,
  setWorldActionBusyId,
  setOpeningActionReceipts,
  worldActionBusyId,
}: CreateMePageActionsArgs) {
  const formatSigned = (value: number) => `${value > 0 ? "+" : ""}${value}`;

  const summarizeResourceDelta = (before: Resources, after: Resources): string[] => {
    const labels: Array<[keyof Resources, string]> = [
      ["food", "food"],
      ["materials", "materials"],
      ["wealth", "wealth"],
      ["mana", "mana"],
      ["knowledge", "knowledge"],
      ["unity", "unity"],
    ];
    return labels
      .map(([key, label]) => {
        const delta = Number(after[key] ?? 0) - Number(before[key] ?? 0);
        return delta !== 0 ? `${label} ${formatSigned(delta)}` : null;
      })
      .filter((entry): entry is string => !!entry);
  };

  const summarizeCityDelta = (before: NonNullable<MeProfile["city"]>, after: NonNullable<MeProfile["city"]>): string[] => {
    const lines: string[] = [];
    const buildingDelta = (after.buildings?.length ?? 0) - (before.buildings?.length ?? 0);
    if (buildingDelta !== 0) lines.push(`buildings ${formatSigned(buildingDelta)}`);
    const heroDelta = (after.stats?.population ?? 0) - (before.stats?.population ?? 0);
    if (heroDelta !== 0) lines.push(`population ${formatSigned(heroDelta)}`);
    const statLabels: Array<[keyof typeof before.stats, string]> = [
      ["stability", "stability"],
      ["prosperity", "prosperity"],
      ["security", "security"],
      ["influence", "influence"],
      ["unity", "unity"],
      ["infrastructure", "infrastructure"],
      ["arcaneSaturation", "arcane"],
    ];
    for (const [key, label] of statLabels) {
      const delta = Number(after.stats?.[key] ?? 0) - Number(before.stats?.[key] ?? 0);
      if (delta !== 0) {
        lines.push(`${label} ${formatSigned(delta)}`);
      }
      if (lines.length >= 4) break;
    }
    return lines;
  };

  const summarizeLoopDelta = (before: MeProfile | null, after: MeProfile | null): string | null => {
    if (!before || !after || !before.city || !after.city) return null;
    const fragments = [
      ...summarizeResourceDelta(before.resources, after.resources),
      ...summarizeCityDelta(before.city, after.city),
    ];
    const activeMissionDelta = (after.activeMissions?.length ?? 0) - (before.activeMissions?.length ?? 0);
    if (activeMissionDelta !== 0) fragments.push(`active missions ${formatSigned(activeMissionDelta)}`);
    const heroRosterDelta = (after.heroes?.length ?? 0) - (before.heroes?.length ?? 0);
    if (heroRosterDelta !== 0) fragments.push(`heroes ${formatSigned(heroRosterDelta)}`);
    return fragments.length ? `Impact: ${fragments.slice(0, 4).join(" • ")}` : null;
  };

  const titleCase = (value: string) =>
    value
      .replace(/_/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase());

  const getBuildingLabel = (buildingId: string) => {
    const building = me?.city?.buildings.find((entry) => entry.id === buildingId);
    return building?.name ?? (building ? titleCase(building.kind) : "Building");
  };

  const getTechLabel = (techId: string) => me?.availableTechs.find((tech) => tech.id === techId)?.name ?? techId;

  const getHeroName = (heroId?: string) => {
    if (!heroId) return null;
    return me?.heroes.find((hero) => hero.id === heroId)?.name ?? null;
  };

  const getArmyLabel = (armyId?: string) => {
    if (!armyId) return null;
    const army = me?.armies.find((entry) => entry.id === armyId);
    return army ? `${titleCase(army.type)} army` : null;
  };

  const describePublicServiceResult = (usage: AppliedPublicServiceUsage | null | undefined, fallback: string) => {
    const summary = summarizeUsage(usage);
    return summary ? `${fallback} ${summary}` : fallback;
  };

  const summarizeMissionLaunch = (result: Awaited<ReturnType<typeof startMission>>) => {
    const missionTitle = result.activeMission?.mission?.title ?? "Mission";
    const support = result.missionSupport;
    const assignedHero = getHeroName(result.activeMission?.assignedHeroId);
    const assignedArmy = getArmyLabel(result.activeMission?.assignedArmyId);
    const assignedUnit = assignedHero ?? assignedArmy;
    const assignmentText = assignedUnit ? `${assignedUnit} committed.` : "Force committed.";
    if (!support) return `${missionTitle} launched. ${assignmentText}`;
    return `${missionTitle} launched. ${assignmentText} ${support.headline} (${support.state}).`;
  };

  const summarizeMissionCompletion = (result: Awaited<ReturnType<typeof completeMission>>) => {
    const latestReceipt = result.missionReceipts?.[0];
    const followup = result.followupOffers?.[0];
    const recovery = result.recoveryOffers?.[0];
    if (latestReceipt) {
      const setbackText = latestReceipt.setbacks?.[0]?.summary ? ` ${latestReceipt.setbacks[0].summary}` : "";
      const followupText = followup ? ` Follow-up opened: ${followup.title}.` : "";
      const recoveryText = recovery ? ` Recovery contract opened: ${recovery.title}.` : "";
      return `${latestReceipt.missionTitle} resolved ${latestReceipt.outcome}.${setbackText}${followupText}${recoveryText}`.trim();
    }
    if (followup || recovery) {
      return `Mission resolved.${followup ? ` Follow-up opened: ${followup.title}.` : ""}${recovery ? ` Recovery contract opened: ${recovery.title}.` : ""}`.trim();
    }
    return "Mission resolved and city state refreshed.";
  };

  const pushOpeningReceipt = (
    title: string,
    detail: string,
    outcome: OpeningActionReceipt["outcome"],
    impactSummary?: string | null,
    actionKey?: string,
  ) => {
    setOpeningActionReceipts((current) => {
      const nowIso = new Date().toISOString();
      const duplicateIndex = current.findIndex(
        (entry) => entry.actionKey === actionKey && entry.title === title && entry.detail === detail && entry.impactSummary === (impactSummary ?? undefined) && entry.outcome === outcome,
      );
      const nextReceipt: OpeningActionReceipt = {
        id: duplicateIndex >= 0 ? current[duplicateIndex].id : `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        actionKey,
        title,
        detail,
        impactSummary: impactSummary ?? undefined,
        outcome,
        timestamp: nowIso,
      };
      const remaining = duplicateIndex >= 0
        ? current.filter((_, index) => index !== duplicateIndex)
        : current;
      return [nextReceipt, ...remaining].slice(0, 5);
    });
  };

  const runAction = async <T,>(
    label: string,
    fn: () => Promise<T>,
    onSuccess?: (result: T, refreshed: MeProfile | null, previous: MeProfile | null) => string | ActionSuccessSummary | null,
    receiptActionKey?: string,
  ) => {
    if (busyAction) return;
    setBusyAction(label);
    setError(null);
    const previousMe = me;
    try {
      const result = await fn();
      const refreshed = await refreshMe(serviceMode);
      const successSummary = onSuccess?.(result, refreshed, previousMe);
      const normalized = typeof successSummary === "string"
        ? { detail: successSummary }
        : (successSummary ?? {});
      const detail = normalized.detail ?? "Action applied and city state refreshed.";
      const impactSummary = normalized.impactSummary ?? summarizeLoopDelta(previousMe, refreshed);
      const outcome = normalized.outcome ?? "success";
      const message = impactSummary ? `${label} ✓ — ${detail} ${impactSummary}` : `${label} ✓ — ${detail}`;
      pushOpeningReceipt(label, detail, outcome, impactSummary, receiptActionKey);
      setFlash("ok", message);
    } catch (err: any) {
      console.error(err);
      const message = err?.message ?? `${label} failed`;
      pushOpeningReceipt(label, message, "failure", undefined, receiptActionKey);
      setFlash("err", message);
    } finally {
      setBusyAction(null);
    }
  };

  const handleBuildBuilding = (kind: CityBuilding["kind"], receiptActionKey?: string) => {
    const buildingLabel = titleCase(kind);
    return runAction(
      `Build ${buildingLabel}`,
      () =>
        api<{ publicService?: AppliedPublicServiceUsage }>("/api/buildings/construct", {
          method: "POST",
          body: JSON.stringify({ kind, serviceMode }),
        }),
      (result) => describePublicServiceResult(result.publicService, `${buildingLabel} secured for the settlement spine.`),
      receiptActionKey,
    );
  };

  const handleUpgradeBuilding = (buildingId: string, receiptActionKey?: string) => {
    const buildingLabel = getBuildingLabel(buildingId);
    return runAction(
      `Upgrade ${buildingLabel}`,
      () =>
        api<{ publicService?: AppliedPublicServiceUsage }>("/api/buildings/upgrade", {
          method: "POST",
          body: JSON.stringify({ buildingId, serviceMode }),
        }),
      (result) => describePublicServiceResult(result.publicService, `${buildingLabel} improved for the next action window.`),
      receiptActionKey,
    );
  };

  const handleTierUpCity = () =>
    runAction("Tier up city", async () => {
      await api("/api/city/tier-up", {
        method: "POST",
        body: JSON.stringify({}),
      });
    });

  const handleCreateCity = () =>
    runAction(`Create ${citySetupLane === "black_market" ? "Black Market" : "City"}`, async () => {
      await bootstrapCity(cityNameDraft, undefined, citySetupLane);
    });

  const handleRenameCity = () =>
    runAction("Rename city", async () => {
      await renameCity(cityNameDraft);
    });

  const handleRaiseArmy = (type: ArmyType) => {
    const armyLabel = titleCase(type);
    return runAction(`Raise ${armyLabel}`, async () => {
      await api("/api/armies/raise", {
        method: "POST",
        body: JSON.stringify({ type }),
      });
    }, () => `${armyLabel} army raised for immediate deployment.`);
  };

  const handleReinforceArmy = (armyId: string) => {
    const armyLabel = getArmyLabel(armyId) ?? "Army";
    return runAction("Reinforce army", async () => {
      await api("/api/armies/reinforce", {
        method: "POST",
        body: JSON.stringify({ armyId }),
      });
    }, () => `${armyLabel} reinforced and pushed back toward readiness.`);
  };

  const handleRecruitHero = (role: HeroRole, receiptActionKey?: string) => {
    const roleLabel = titleCase(role);
    return runAction(
      `Recruit ${roleLabel}`,
      () =>
        api<{ publicService?: AppliedPublicServiceUsage }>("/api/heroes/recruit", {
          method: "POST",
          body: JSON.stringify({ role, serviceMode }),
        }),
      (result) => describePublicServiceResult(result.publicService, `${roleLabel} added to the roster for immediate assignments.`),
      receiptActionKey,
    );
  };

  const handleEquipHeroAttachment = (
    heroId: string,
    kind: "valor_charm" | "scouting_cloak" | "arcane_focus"
  ) => {
    const heroName = getHeroName(heroId) ?? "Hero";
    const attachmentLabel = titleCase(kind);
    return runAction("Equip attachment", async () => {
      await api("/api/heroes/equip_attachment", {
        method: "POST",
        body: JSON.stringify({ heroId, kind }),
      });
    }, () => `${attachmentLabel} equipped on ${heroName}.`);
  };

  const handleWorkshopCraft = (kind: "valor_charm" | "scouting_cloak" | "arcane_focus") => {
    const craftLabel = titleCase(kind);
    return runAction(
      `Craft ${craftLabel}`,
      () =>
        api<{ publicService?: AppliedPublicServiceUsage }>("/api/workshop/craft", {
          method: "POST",
          body: JSON.stringify({ kind, serviceMode }),
        }),
      (result) => describePublicServiceResult(result.publicService, `${craftLabel} entered the workshop queue.`)
    );
  };

  const handleWorkshopCollect = (jobId: string) =>
    runAction("Collect craft", async () => {
      await api("/api/workshop/collect", {
        method: "POST",
        body: JSON.stringify({ jobId }),
      });
    }, () => "Workshop output collected and returned to inventory.");

  const handleTogglePolicy = (key: keyof MeProfile["policies"]) => {
    if (!me) return;
    return runAction(`Toggle ${String(key)}`, async () => {
      await api("/api/policies/toggle", {
        method: "POST",
        body: JSON.stringify({ key, value: !me.policies[key] }),
      });
    }, () => ({ detail: `${titleCase(String(key))} policy updated.` }));
  };

  const handleStartTech = (techId: string) => {
    const techLabel = getTechLabel(techId);
    return runAction(
      `Start research ${techLabel}`,
      () => startTech(techId, serviceMode),
      (result: any) => describePublicServiceResult(result?.publicService, `${techLabel} research opened for the city.`)
    );
  };

  const handleStartMission = (
    missionId: string,
    heroId?: string,
    armyId?: string,
    responsePosture?: "cautious" | "balanced" | "aggressive" | "desperate",
    receiptActionKey?: string,
  ) =>
    runAction(
      "Start mission",
      () => startMission(missionId, heroId, armyId, responsePosture),
      (result) => summarizeMissionLaunch(result),
      receiptActionKey,
    );

  const handleCompleteMission = (instanceId: string) =>
    runAction(
      "Complete mission",
      () => completeMission(instanceId),
      (result) => summarizeMissionCompletion(result)
    );

  const handleExecuteOpeningOperation = (operation: SettlementOpeningOperation) => {
    const receiptActionKey = getOpeningOperationReceiptKey(operation);
    switch (operation.action.kind) {
      case "build_building":
        return handleBuildBuilding(operation.action.buildingKind, receiptActionKey);
      case "upgrade_building":
        return handleUpgradeBuilding(operation.action.buildingId, receiptActionKey);
      case "start_mission":
        return handleStartMission(
          operation.action.missionId,
          operation.action.heroId,
          operation.action.armyId,
          operation.action.responsePosture,
          receiptActionKey,
        );
      case "execute_world_action": {
        const openingAction = operation.action as typeof operation.action & { actionId?: string };
        const actionId = typeof openingAction.actionId === "string" ? openingAction.actionId : null;
        if (!actionId) {
          setFlash("err", "Opening action is missing its world-action id.");
          return;
        }
        const action = me?.worldConsequenceActions?.playerActions.find((entry) => entry.id === actionId);
        if (!action) {
          setFlash("err", "Opening action drifted out of the world-action board.");
          return;
        }
        return handleExecuteWorldAction(action, receiptActionKey);
      }
      case "recruit_hero":
        return handleRecruitHero(operation.action.role, receiptActionKey);
      default:
        return;
    }
  };

  const handleExecuteWorldAction = async (action: WorldConsequenceActionItem, receiptActionKey?: string) => {
    if (worldActionBusyId) return;
    setWorldActionBusyId(action.id);
    setError(null);
    try {
      const previousMe = me;
      const result = await executeWorldConsequenceAction(action.id);
      const refreshedMe = await refreshMe(serviceMode);
      const applied = result?.result?.appliedEffect;
      const appliedSummary = applied
        ? ` pressure ${formatWorldDelta(applied.pressureDelta)} • recovery ${formatWorldDelta(applied.recoveryDelta)} • trust ${formatWorldDelta(applied.trustDelta)} • control ${formatWorldDelta(applied.controlDelta)} • threat ${formatWorldDelta(applied.threatDelta)}`
        : "";
      const message = `${result?.result?.message ?? `${action.title} executed.`}${appliedSummary}`;
      const loopImpact = summarizeLoopDelta(previousMe, refreshedMe);
      pushOpeningReceipt(action.title, message, "success", loopImpact, receiptActionKey);
      setFlash("ok", message);
    } catch (err: any) {
      console.error(err);
      const result = err instanceof ApiResponseError ? err.data?.result : undefined;
      const shortfall = result?.shortfall;
      const shortfallText = shortfall && Object.keys(shortfall).length > 0
        ? ` Still needed ${formatWorldActionCost(shortfall)}.`
        : "";
      const cooldownText = result?.status === "cooldown_active" && result?.cooldownMsRemaining
        ? ` Ready again in ${formatWorldActionCooldown(result.cooldownMsRemaining)}.`
        : result?.status === "cooldown_active" && result?.readyAt
          ? ` Ready again at ${new Date(result.readyAt).toLocaleString()}.`
          : "";
      const message = `${err?.message ?? `Failed to execute ${action.title}.`}${shortfallText}${cooldownText}`;
      pushOpeningReceipt(action.title, message, "failure", undefined, receiptActionKey);
      setFlash("err", message);
    } finally {
      setWorldActionBusyId(null);
    }
  };

  return {
    handleBuildBuilding,
    handleCompleteMission,
    handleCreateCity,
    handleEquipHeroAttachment,
    handleExecuteOpeningOperation,
    handleExecuteWorldAction,
    handleRaiseArmy,
    handleRecruitHero,
    handleReinforceArmy,
    handleRenameCity,
    handleStartMission,
    handleStartTech,
    handleTierUpCity,
    handleTogglePolicy,
    handleUpgradeBuilding,
    handleWorkshopCollect,
    handleWorkshopCraft,
  };
}
