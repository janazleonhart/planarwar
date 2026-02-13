// worldcore/mud/commands/player/trainCommand.ts
//
// Spell + Ability Rank System v0.x
//
// "train" converts granted (pending) spell/ability ranks into learned entries.
//
// v0.4+: bulk modes (train all / spells / abilities)
// v0.6+: preview mode (train preview [all|spells|abilities])
// v0.7+: single-target preview (train preview <spellId|abilityId|name>)
// v0.9+: preview "why" flag (train preview --why ...)

import type { MudContext } from "../../MudContext";

import { canLearnSpellForChar, listPendingSpellsForChar } from "../../../spells/SpellLearning";
import { canLearnAbilityForChar, isAbilityKnownForChar, listPendingAbilitiesForChar } from "../../../abilities/AbilityLearning";
import { getSpellByIdOrAlias, isSpellKnownForChar, resolveSpellId } from "../../../spells/SpellTypes";
import { findAbilityByNameOrId } from "../../../abilities/AbilityTypes";

function isAtTrainer(ctx: MudContext, char: any): boolean {
  const s: any = (ctx as any)?.session;
  if (!s) return false;

  // Tests and admin tooling can set this directly.
  if (s.isAtTrainer === true || s.atTrainer === true) return true;
  if (s.flags && (s.flags.isAtTrainer === true || s.flags.atTrainer === true)) return true;

  // Canonical runtime: derive trainer proximity from room entities.
  // This avoids relying on name matching and makes trainers world-authorable.
  const roomId =
    s.roomId ??
    s.room?.id ??
    s.room?.roomId ??
    s.world?.roomId;
  if (!roomId) return false;

  const em: any = (ctx as any)?.entities;
  if (!em?.getEntitiesInRoom) return false;

  const cx = Number(char?.pos?.x ?? char?.x ?? char?.posX);
  const cz = Number(char?.pos?.z ?? char?.z ?? char?.posZ);
  if (!Number.isFinite(cx) || !Number.isFinite(cz)) return false;

  const radius = (() => {
    const v = process.env.PW_SERVICE_RADIUS;
    const n = Number(v);
    // Match serviceGates default radius (~2.5) unless overridden.
    return Number.isFinite(n) && n > 0 ? n : 2.5;
  })();

  const ents = em.getEntitiesInRoom(String(roomId)) ?? [];

  const norm = (x: any) => String(x ?? "").trim().toLowerCase();

  const isTrainerAnchor = (e: any): boolean => {
    const t = norm(e?.type);
    const tags = Array.isArray(e?.tags) ? e.tags.map(norm) : [];
    const roles = Array.isArray(e?.roles) ? e.roles.map(norm) : [];

    if (t === "trainer" || t === "spelltrainer" || t === "abilitytrainer" || t === "class_trainer" || t === "class_trainer_npc") return true;
    if (tags.includes("service_trainer")) return true;
    if (tags.includes("protected_service") && (roles.includes("trainer") || tags.includes("trainer"))) return true;
    if (tags.includes("trainer")) return true;
    return false;
  };

  for (const e of ents) {
    if (!isTrainerAnchor(e)) continue;

    const ex = Number(e?.x ?? e?.pos?.x);
    const ez = Number(e?.z ?? e?.pos?.z);
    if (!Number.isFinite(ex) || !Number.isFinite(ez)) continue;

    const dx = cx - ex;
    const dz = cz - ez;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d <= radius) return true;
  }

  return false;
}


function nameFor(label: "Spells" | "Abilities", id: string): string | null {
  if (label === "Spells") return (getSpellByIdOrAlias(id) as any)?.name ?? null;
  return (findAbilityByNameOrId(id) as any)?.name ?? null;
}

function fmtList(items: string[], label: "Spells" | "Abilities"): string {
  if (!items.length) return `${label}: none.`;
  const lines = items.map((id) => {
    const name = nameFor(label, id);
    return `- ${name ? `${name} ` : ""}(${id})`;
  });
  return `${label} pending training:\n${lines.join("\n")}`;
}

function fmtTrained(items: string[], label: "Spells" | "Abilities"): string {
  if (!items.length) return `${label} trained: none.`;
  const lines = items.map((id) => {
    const name = nameFor(label, id);
    return `- ${name ? `${name} ` : ""}(${id})`;
  });
  return `${label} trained:\n${lines.join("\n")}`;
}

function fmtUntrained(items: { id: string; reason: string }[], label: "Spells" | "Abilities"): string {
  if (!items.length) return `${label} untrained: none.`;
  const lines = items.map((x) => {
    const name = nameFor(label, x.id);
    return `- ${name ? `${name} ` : ""}(${x.id}): ${x.reason}`;
  });
  return `${label} untrained:\n${lines.join("\n")}`;
}

function mapLearnError(err: string): string {
  switch (String(err)) {
    case "requires_trainer":
      return "requires trainer";
    case "level_too_low":
      return "level too low";
    case "not_learnable":
      return "not learnable";
    case "class_mismatch":
      return "class mismatch";
    case "requires_grant":
      return "requires grant";
    default:
      return String(err);
  }
}

function withRequiredLevelHint(base: string, minLevel: number | undefined): string {
  const n = Number(minLevel ?? NaN);
  if (Number.isFinite(n) && n > 0) return `${base} (requires level ${n})`;
  return base;
}

function fmtWhySuffix(res: any, label: "Spell" | "Ability"): string {
  const err = String(res?.error ?? "").trim();
  if (!err) return "";

  const parts: string[] = [`error=${err}`];
  const rule: any = res?.requiredRule;
  if (rule) {
    if (rule.classId != null) parts.push(`rule.classId=${String(rule.classId)}`);
    if (rule.minLevel != null) parts.push(`rule.minLevel=${String(rule.minLevel)}`);
  } else {
    const def: any = label === "Spell" ? res?.spell : res?.ability;
    if (def?.classId != null) parts.push(`def.classId=${String(def.classId)}`);
    if (def?.minLevel != null) parts.push(`def.minLevel=${String(def.minLevel)}`);
  }

  return ` [why: ${parts.join(", ")}]`;
}

function fmtPreview(items: { id: string; ok: boolean; reason?: string }[], label: "Spells" | "Abilities"): string {
  if (!items.length) return `${label} preview: none.`;

  const trainable = items.filter((x) => x.ok);
  const blocked = items.filter((x) => !x.ok);

  const parts: string[] = [];

  if (trainable.length) {
    parts.push(
      `${label} trainable now:\n${trainable
        .map((x) => {
          const name = nameFor(label, x.id);
          return `- ${name ? `${name} ` : ""}(${x.id})`;
        })
        .join("\n")}`,
    );
  } else {
    parts.push(`${label} trainable now: none.`);
  }

  if (blocked.length) {
    parts.push(
      `${label} blocked:\n${blocked
        .map((x) => {
          const name = nameFor(label, x.id);
          return `- ${name ? `${name} ` : ""}(${x.id}): ${x.reason ?? "blocked"}`;
        })
        .join("\n")}`,
    );
  } else {
    parts.push(`${label} blocked: none.`);
  }

  return parts.join("\n\n");
}

function fmtSinglePreview(row: {
  label: "Spell" | "Ability";
  id: string;
  name: string;
  status: "learned" | "pending" | "not_granted";
  ok: boolean;
  reason?: string;
}): string {
  const parts: string[] = [];
  parts.push(`${row.label} preview: ${row.name} [${row.id}]`);
  parts.push(`Status: ${row.status === "not_granted" ? "not granted" : row.status}.`);
  parts.push(`Trainable now: ${row.ok ? "yes" : "no"}.`);
  if (!row.ok) parts.push(`Blocked: ${row.reason ?? "blocked"}.`);
  parts.push("Tip: use `train` in town near a trainer to convert pending grants into learned ranks.");
  return parts.join("\n");
}

function mapLearnErrorWithRule(res: any, label: "Spell" | "Ability"): string {
  const base = mapLearnError(res?.error);
  if (res?.error === "level_too_low") {
    const minLevel = Number(
      res?.requiredRule?.minLevel ??
        (label === "Spell" ? (res?.spell as any)?.minLevel : (res?.ability as any)?.minLevel) ??
        NaN,
    );
    return withRequiredLevelHint(base, Number.isFinite(minLevel) ? minLevel : undefined);
  }
  return base;
}

function resolvePendingStatus(
  char: any,
  kind: "spell" | "ability",
  canonicalId: string,
): "learned" | "pending" | "not_granted" {
  if (kind === "spell") {
    if (isSpellKnownForChar(char as any, canonicalId)) return "learned";
    const pending = new Set(listPendingSpellsForChar(char as any));
    return pending.has(canonicalId) ? "pending" : "not_granted";
  }

  if (isAbilityKnownForChar(char as any, canonicalId)) return "learned";
  const pending = new Set(listPendingAbilitiesForChar(char as any));
  return pending.has(canonicalId) ? "pending" : "not_granted";
}

export async function handleTrainCommand(ctx: MudContext, args: string[]): Promise<string> {
  const char = ctx.session.character;
  if (!char) return "You do not have an active character.";
  if (!ctx.characters) return "Character service unavailable.";

  const atTrainer = isAtTrainer(ctx, char);

  const sub = String(args[0] ?? "").trim().toLowerCase();

  // Default: show what is pending.
  if (!sub || sub === "list") {
    const pSpells = listPendingSpellsForChar(char as any);
    const pAbilities = listPendingAbilitiesForChar(char as any);
    if (!pSpells.length && !pAbilities.length) {
      return "You have nothing waiting to be trained.";
    }
    const parts: string[] = [];
    if (pSpells.length) parts.push(fmtList(pSpells, "Spells"));
    if (pAbilities.length) parts.push(fmtList(pAbilities, "Abilities"));
    return parts.join("\n\n");
  }

  // Preview mode:
  // train preview
  // train preview all
  // train preview spells
  // train preview abilities
  if (sub === "preview" || sub === "pv") {
    const rest = args.slice(1).map((x) => String(x ?? "").trim()).filter(Boolean);
    const why = rest.some((x) => x === "--why" || x === "why");
    const restNoFlags = rest.filter((x) => x !== "--why" && x !== "why");

    const first = String(restNoFlags[0] ?? "").trim();
    const mode = first.toLowerCase() || "all";

    const isMode = mode === "all" || mode === "spells" || mode === "spell" || mode === "abilities" || mode === "ability";
    if (!isMode && first) {
      // Single-target preview: train preview <id|name>
      const raw = restNoFlags.join(" ").trim();
      if (!raw) return "Usage: train preview [--why] [all|spells|abilities] | train preview [--why] <spellId|abilityId|name>";

      // Try spell first.
      const sDef: any = getSpellByIdOrAlias(raw);
      const sId = sDef ? resolveSpellId(String(sDef.id ?? raw)) : resolveSpellId(raw);

      // Then ability.
      const aDef: any = findAbilityByNameOrId(raw);
      const aId = aDef ? String(aDef.id ?? "") : "";

      const pendingSpells = new Set(listPendingSpellsForChar(char as any));
      const pendingAbilities = new Set(listPendingAbilitiesForChar(char as any));

      const spellCandidate = !!(sDef && sId);
      const abilityCandidate = !!(aDef && aId);

      // If both match, prefer whatever is pending. Otherwise, prefer spell.
      const chooseSpell =
        spellCandidate &&
        (!abilityCandidate || pendingSpells.has(String(sId)) || !pendingAbilities.has(String(aId)));

      if (chooseSpell && sDef && sId) {
        const status = resolvePendingStatus(char as any, "spell", String(sId));
        const res: any = canLearnSpellForChar(char as any, String(sId), { viaTrainer: atTrainer });
        const def: any = getSpellByIdOrAlias(String(sId));
        if (!res.ok) (res as any).spell = def;
        return fmtSinglePreview({
          label: "Spell",
          id: String(sId),
          name: String(sDef.name ?? sId),
          status,
          ok: !!res.ok,
          reason: res.ok ? undefined : `${mapLearnErrorWithRule(res, "Spell")}${why ? fmtWhySuffix(res, "Spell") : ""}`,
        });
      }

      if (abilityCandidate && aDef && aId) {
        const id = String(aId).toLowerCase().trim();
        const status = resolvePendingStatus(char as any, "ability", id);
        const res: any = canLearnAbilityForChar(char as any, id, { viaTrainer: atTrainer });
        const def: any = findAbilityByNameOrId(id);
        if (!res.ok) (res as any).ability = def;
        return fmtSinglePreview({
          label: "Ability",
          id,
          name: String(aDef.name ?? id),
          status,
          ok: !!res.ok,
          reason: res.ok ? undefined : `${mapLearnErrorWithRule(res, "Ability")}${why ? fmtWhySuffix(res, "Ability") : ""}`,
        });
      }

      return "Unknown spell or ability.";
    }

    const doSpells = mode === "all" || mode === "spells" || mode === "spell";
    const doAbilities = mode === "all" || mode === "abilities" || mode === "ability";

    const pSpells = doSpells ? listPendingSpellsForChar(char as any) : [];
    const pAbilities = doAbilities ? listPendingAbilitiesForChar(char as any) : [];

    if (!pSpells.length && !pAbilities.length) {
      return "You have nothing waiting to be trained.";
    }

    const parts: string[] = [];

    if (doSpells) {
      const rows = pSpells.map((id) => {
        const res: any = canLearnSpellForChar(char as any, id, { viaTrainer: atTrainer });
        if (res.ok) return { id, ok: true as const };
        const def: any = getSpellByIdOrAlias(id);
        if (!res.ok) (res as any).spell = def;
        const reasonBase = res.error === "level_too_low"
          ? withRequiredLevelHint(mapLearnError(res.error), Number(res?.requiredRule?.minLevel ?? def?.minLevel))
          : mapLearnError(res.error);
        const reason = `${reasonBase}${why ? fmtWhySuffix(res, "Spell") : ""}`;
        return { id, ok: false as const, reason };
      });
      parts.push(fmtPreview(rows as any, "Spells"));
    }

    if (doAbilities) {
      const rows = pAbilities.map((id) => {
        const res: any = canLearnAbilityForChar(char as any, id, { viaTrainer: atTrainer });
        if (res.ok) return { id, ok: true as const };
        const def: any = findAbilityByNameOrId(id);
        if (!res.ok) (res as any).ability = def;
        const reasonBase = res.error === "level_too_low"
          ? withRequiredLevelHint(mapLearnError(res.error), Number(res?.requiredRule?.minLevel ?? def?.minLevel))
          : mapLearnError(res.error);
        const reason = `${reasonBase}${why ? fmtWhySuffix(res, "Ability") : ""}`;
        return { id, ok: false as const, reason };
      });
      parts.push(fmtPreview(rows as any, "Abilities"));
    }

    parts.push("Tip: use `train all` (or `train spells` / `train abilities`) to perform training at a trainer.");

    return parts.join("\n\n");
  }

  // Bulk training:
  // train all
  // train spells
  // train abilities
  if (sub === "all" || sub === "spells" || sub === "abilities") {
    if (!atTrainer) {
      return "You must be at a trainer to train spells or abilities.";
    }
    const doSpells = sub === "all" || sub === "spells";
    const doAbilities = sub === "all" || sub === "abilities";

    const startChar: any = ctx.session.character;
    const userId = (startChar as any).userId;
    const charId = (startChar as any).id;

    const trainedSpells: string[] = [];
    const trainedAbilities: string[] = [];
    const untrainedSpells: { id: string; reason: string }[] = [];
    const untrainedAbilities: { id: string; reason: string }[] = [];

    if (doSpells) {
      for (const id of listPendingSpellsForChar(ctx.session.character as any)) {
        const res = await ctx.characters.learnSpellWithRules(userId, charId, id, 1, { viaTrainer: atTrainer });
        if (!res.ok) {
          const def: any = getSpellByIdOrAlias(id);
          const reason = res.error === "level_too_low"
            ? withRequiredLevelHint(mapLearnError(res.error), Number((res as any)?.requiredRule?.minLevel ?? def?.minLevel))
            : mapLearnError(res.error);
          untrainedSpells.push({ id, reason });
          continue;
        }
        ctx.session.character = res.character as any;
        trainedSpells.push(id);
      }
    }

    if (doAbilities) {
      for (const id of listPendingAbilitiesForChar(ctx.session.character as any)) {
        const res = await ctx.characters.learnAbilityWithRules(userId, charId, id, 1, { viaTrainer: atTrainer });
        if (!res.ok) {
          const def: any = findAbilityByNameOrId(id);
          const reason = res.error === "level_too_low"
            ? withRequiredLevelHint(mapLearnError(res.error), Number((res as any)?.requiredRule?.minLevel ?? def?.minLevel))
            : mapLearnError(res.error);
          untrainedAbilities.push({ id, reason });
          continue;
        }
        ctx.session.character = res.character as any;
        trainedAbilities.push(id);
      }
    }

    if (!trainedSpells.length && !trainedAbilities.length && !untrainedSpells.length && !untrainedAbilities.length) {
      return "You have nothing waiting to be trained.";
    }

    const parts: string[] = [];
    if (doSpells) {
      parts.push(fmtTrained(trainedSpells, "Spells"));
      parts.push(fmtUntrained(untrainedSpells, "Spells"));
    }
    if (doAbilities) {
      parts.push(fmtTrained(trainedAbilities, "Abilities"));
      parts.push(fmtUntrained(untrainedAbilities, "Abilities"));
    }
    return parts.join("\n\n");
  }

  // train spell <id|name>
  // train ability <id|name>
  if (sub === "spell" || sub === "sp") {
    if (!atTrainer) return "You must be at a trainer to learn that.";
    const raw = args.slice(1).join(" ").trim();
    if (!raw) return "Usage: train spell <spellId|spellName>";

    const def: any = getSpellByIdOrAlias(raw);
    if (!def) return "Unknown spell.";

    const pending = new Set(listPendingSpellsForChar(char as any));
    if (!pending.has(def.id)) {
      return `You do not have ${def.name} granted (pending training).`;
    }

    const res = await ctx.characters.learnSpellWithRules((char as any).userId, (char as any).id, def.id, 1, { viaTrainer: atTrainer });

    if (!res.ok) {
      if (res.error === "requires_grant") return `You do not have ${def.name} granted (pending training).`;
      if (res.error === "requires_trainer") return "You must be at a trainer to learn that.";
      if (res.error === "level_too_low") return `You are not high enough level to learn ${def.name}.`;
      if (res.error === "not_learnable") return "You cannot learn that.";
      return `Training failed: ${res.error}`;
    }

    // Update session character to the persisted result.
    ctx.session.character = res.character as any;
    return `You train ${def.name}.`;
  }

  if (sub === "ability" || sub === "ab") {
    if (!atTrainer) return "You must be at a trainer to learn that.";
    const raw = args.slice(1).join(" ").trim();
    if (!raw) return "Usage: train ability <abilityId|abilityName>";

    const def: any = findAbilityByNameOrId(raw);
    if (!def) return "Unknown ability.";

    const pending = new Set(listPendingAbilitiesForChar(char as any));
    if (!pending.has(def.id)) {
      return `You do not have ${def.name} granted (pending training).`;
    }

    const res = await ctx.characters.learnAbilityWithRules((char as any).userId, (char as any).id, def.id, 1, { viaTrainer: atTrainer });

    if (!res.ok) {
      if (res.error === "requires_grant") return `You do not have ${def.name} granted (pending training).`;
      if (res.error === "requires_trainer") return "You must be at a trainer to learn that.";
      if (res.error === "level_too_low") return `You are not high enough level to learn ${def.name}.`;
      if (res.error === "not_learnable") return "You cannot learn that.";
      return `Training failed: ${res.error}`;
    }

    ctx.session.character = res.character as any;
    return `You train ${def.name}.`;
  }

  return "Usage: train [list] | train preview [--why] [all|spells|abilities|<id>] | train all | train spells | train abilities | train spell <spell> | train ability <ability>";
}
