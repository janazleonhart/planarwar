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
  refreshMe: (mode?: InfrastructureMode) => Promise<void>;
  serviceMode: InfrastructureMode;
  setBusyAction: (value: string | null) => void;
  setError: (value: string | null) => void;
  setFlash: MePageFlashSetter;
  setWorldActionBusyId: (value: string | null) => void;
  setOpeningActionReceipts: Dispatch<SetStateAction<OpeningActionReceipt[]>>;
  worldActionBusyId: string | null;
};

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
    if (latestReceipt) {
      const setbackText = latestReceipt.setbacks?.[0]?.summary ? ` ${latestReceipt.setbacks[0].summary}` : "";
      return `${latestReceipt.missionTitle} resolved ${latestReceipt.outcome}.${setbackText}`.trim();
    }
    return "Mission resolved and city state refreshed.";
  };

  const pushOpeningReceipt = (title: string, detail: string, outcome: OpeningActionReceipt["outcome"]) => {
    setOpeningActionReceipts((current) => {
      const nowIso = new Date().toISOString();
      const duplicateIndex = current.findIndex((entry) => entry.title === title && entry.detail === detail && entry.outcome === outcome);
      const nextReceipt: OpeningActionReceipt = {
        id: duplicateIndex >= 0 ? current[duplicateIndex].id : `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        title,
        detail,
        outcome,
        timestamp: nowIso,
      };
      const remaining = duplicateIndex >= 0
        ? current.filter((_, index) => index !== duplicateIndex)
        : current;
      return [nextReceipt, ...remaining].slice(0, 5);
    });
  };

  const runAction = async <T,>(label: string, fn: () => Promise<T>, onSuccess?: (result: T) => string | null) => {
    if (busyAction) return;
    setBusyAction(label);
    setError(null);
    try {
      const result = await fn();
      await refreshMe(serviceMode);
      const extra = onSuccess?.(result);
      const message = extra ? `${label} ✓ — ${extra}` : `${label} ✓`;
      pushOpeningReceipt(label, extra ?? "Action applied and city state refreshed.", "success");
      setFlash("ok", message);
    } catch (err: any) {
      console.error(err);
      const message = err?.message ?? `${label} failed`;
      pushOpeningReceipt(label, message, "failure");
      setFlash("err", message);
    } finally {
      setBusyAction(null);
    }
  };

  const handleBuildBuilding = (kind: CityBuilding["kind"]) => {
    const buildingLabel = titleCase(kind);
    return runAction(
      `Build ${buildingLabel}`,
      () =>
        api<{ publicService?: AppliedPublicServiceUsage }>("/api/buildings/construct", {
          method: "POST",
          body: JSON.stringify({ kind, serviceMode }),
        }),
      (result) => describePublicServiceResult(result.publicService, `${buildingLabel} secured for the settlement spine.`)
    );
  };

  const handleUpgradeBuilding = (buildingId: string) => {
    const buildingLabel = getBuildingLabel(buildingId);
    return runAction(
      `Upgrade ${buildingLabel}`,
      () =>
        api<{ publicService?: AppliedPublicServiceUsage }>("/api/buildings/upgrade", {
          method: "POST",
          body: JSON.stringify({ buildingId, serviceMode }),
        }),
      (result) => describePublicServiceResult(result.publicService, `${buildingLabel} improved for the next action window.`)
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

  const handleRecruitHero = (role: HeroRole) => {
    const roleLabel = titleCase(role);
    return runAction(
      `Recruit ${roleLabel}`,
      () =>
        api<{ publicService?: AppliedPublicServiceUsage }>("/api/heroes/recruit", {
          method: "POST",
          body: JSON.stringify({ role, serviceMode }),
        }),
      (result) => describePublicServiceResult(result.publicService, `${roleLabel} added to the roster for immediate assignments.`)
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
    }, () => `${titleCase(String(key))} policy updated.`);
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
    responsePosture?: "cautious" | "balanced" | "aggressive" | "desperate"
  ) =>
    runAction(
      "Start mission",
      () => startMission(missionId, heroId, armyId, responsePosture),
      (result) => summarizeMissionLaunch(result)
    );

  const handleCompleteMission = (instanceId: string) =>
    runAction(
      "Complete mission",
      () => completeMission(instanceId),
      (result) => summarizeMissionCompletion(result)
    );

  const handleExecuteOpeningOperation = (operation: SettlementOpeningOperation) => {
    switch (operation.action.kind) {
      case "build_building":
        return handleBuildBuilding(operation.action.buildingKind);
      case "upgrade_building":
        return handleUpgradeBuilding(operation.action.buildingId);
      case "start_mission":
        return handleStartMission(
          operation.action.missionId,
          operation.action.heroId,
          operation.action.armyId,
          operation.action.responsePosture,
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
        return handleExecuteWorldAction(action);
      }
      case "recruit_hero":
        return handleRecruitHero(operation.action.role);
      default:
        return;
    }
  };

  const handleExecuteWorldAction = async (action: WorldConsequenceActionItem) => {
    if (worldActionBusyId) return;
    setWorldActionBusyId(action.id);
    setError(null);
    try {
      const result = await executeWorldConsequenceAction(action.id);
      await refreshMe(serviceMode);
      const applied = result?.result?.appliedEffect;
      const appliedSummary = applied
        ? ` pressure ${formatWorldDelta(applied.pressureDelta)} • recovery ${formatWorldDelta(applied.recoveryDelta)} • trust ${formatWorldDelta(applied.trustDelta)} • control ${formatWorldDelta(applied.controlDelta)} • threat ${formatWorldDelta(applied.threatDelta)}`
        : "";
      const message = `${result?.result?.message ?? `${action.title} executed.`}${appliedSummary}`;
      pushOpeningReceipt(action.title, message, "success");
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
      pushOpeningReceipt(action.title, message, "failure");
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
