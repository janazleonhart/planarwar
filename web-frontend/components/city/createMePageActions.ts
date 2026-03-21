// web-frontend/components/city/createMePageActions.ts

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
  type WorldConsequenceActionItem,
} from "../../lib/api";
import {
  formatWorldActionCooldown,
  formatWorldActionCost,
  formatWorldDelta,
} from "../worldResponse/worldResponseUi";
import { summarizeUsage } from "./CityUiHelpers";

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
  worldActionBusyId,
}: CreateMePageActionsArgs) {
  const runAction = async <T,>(label: string, fn: () => Promise<T>, onSuccess?: (result: T) => string | null) => {
    if (busyAction) return;
    setBusyAction(label);
    setError(null);
    try {
      const result = await fn();
      await refreshMe(serviceMode);
      const extra = onSuccess?.(result);
      setFlash("ok", extra ? `${label} ✓ — ${extra}` : `${label} ✓`);
    } catch (err: any) {
      console.error(err);
      setFlash("err", err?.message ?? `${label} failed`);
    } finally {
      setBusyAction(null);
    }
  };

  const handleBuildBuilding = (kind: CityBuilding["kind"]) =>
    runAction(
      `Build ${kind}`,
      () =>
        api<{ publicService?: AppliedPublicServiceUsage }>("/api/buildings/construct", {
          method: "POST",
          body: JSON.stringify({ kind, serviceMode }),
        }),
      (result) => summarizeUsage(result.publicService)
    );

  const handleUpgradeBuilding = (buildingId: string) =>
    runAction(
      "Upgrade building",
      () =>
        api<{ publicService?: AppliedPublicServiceUsage }>("/api/buildings/upgrade", {
          method: "POST",
          body: JSON.stringify({ buildingId, serviceMode }),
        }),
      (result) => summarizeUsage(result.publicService)
    );

  const handleTierUpCity = () =>
    runAction("Tier up city", async () => {
      await api("/api/city/tier-up", {
        method: "POST",
        body: JSON.stringify({}),
      });
    });

  const handleCreateCity = () =>
    runAction("Create city", async () => {
      await bootstrapCity(cityNameDraft, undefined, citySetupLane);
    });

  const handleRenameCity = () =>
    runAction("Rename city", async () => {
      await renameCity(cityNameDraft);
    });

  const handleRaiseArmy = (type: ArmyType) =>
    runAction(`Raise ${type}`, async () => {
      await api("/api/armies/raise", {
        method: "POST",
        body: JSON.stringify({ type }),
      });
    });

  const handleReinforceArmy = (armyId: string) =>
    runAction("Reinforce army", async () => {
      await api("/api/armies/reinforce", {
        method: "POST",
        body: JSON.stringify({ armyId }),
      });
    });

  const handleRecruitHero = (role: HeroRole) =>
    runAction(
      `Recruit ${role}`,
      () =>
        api<{ publicService?: AppliedPublicServiceUsage }>("/api/heroes/recruit", {
          method: "POST",
          body: JSON.stringify({ role, serviceMode }),
        }),
      (result) => summarizeUsage(result.publicService)
    );

  const handleEquipHeroAttachment = (
    heroId: string,
    kind: "valor_charm" | "scouting_cloak" | "arcane_focus"
  ) =>
    runAction("Equip attachment", async () => {
      await api("/api/heroes/equip_attachment", {
        method: "POST",
        body: JSON.stringify({ heroId, kind }),
      });
    });

  const handleWorkshopCraft = (kind: "valor_charm" | "scouting_cloak" | "arcane_focus") =>
    runAction(
      `Craft ${kind}`,
      () =>
        api<{ publicService?: AppliedPublicServiceUsage }>("/api/workshop/craft", {
          method: "POST",
          body: JSON.stringify({ kind, serviceMode }),
        }),
      (result) => summarizeUsage(result.publicService)
    );

  const handleWorkshopCollect = (jobId: string) =>
    runAction("Collect craft", async () => {
      await api("/api/workshop/collect", {
        method: "POST",
        body: JSON.stringify({ jobId }),
      });
    });

  const handleTogglePolicy = (key: keyof MeProfile["policies"]) => {
    if (!me) return;
    return runAction(`Toggle ${String(key)}`, async () => {
      await api("/api/policies/toggle", {
        method: "POST",
        body: JSON.stringify({ key, value: !me.policies[key] }),
      });
    });
  };

  const handleStartTech = (techId: string) =>
    runAction(
      `Start tech ${techId}`,
      () => startTech(techId, serviceMode),
      (result: any) => summarizeUsage(result?.publicService)
    );

  const handleStartMission = (
    missionId: string,
    heroId?: string,
    armyId?: string,
    responsePosture?: "cautious" | "balanced" | "aggressive" | "desperate"
  ) =>
    runAction(
      "Start mission",
      () => startMission(missionId, heroId, armyId, responsePosture),
      (result) => {
        const support = result?.missionSupport;
        if (!support) return "Mission launched.";
        return `${support.headline} (${support.state})`;
      }
    );

  const handleCompleteMission = (instanceId: string) =>
    runAction(
      "Complete mission",
      () => completeMission(instanceId),
      () => "Mission resolved and city state refreshed."
    );

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
      setFlash("ok", `${result?.result?.message ?? `${action.title} executed.`}${appliedSummary}`);
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
      setFlash("err", `${err?.message ?? `Failed to execute ${action.title}.`}${shortfallText}${cooldownText}`);
    } finally {
      setWorldActionBusyId(null);
    }
  };

  return {
    handleBuildBuilding,
    handleCompleteMission,
    handleCreateCity,
    handleEquipHeroAttachment,
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
