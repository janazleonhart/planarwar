// worldcore/mud/commands/player/ranksCommand.ts
//
// Spell + Ability Rank System v0.x
//
// "ranks" is an informational command:
// - shows pending grants (things you can train)
// - shows learned higher-rank spells/abilities (rank > 1)
//
// Learning (converting pending -> learned) is handled by trainCommand.ts

import type { MudContext } from "../../MudContext";

import { listPendingSpellsForChar } from "../../../spells/SpellLearning";
import { listPendingAbilitiesForChar } from "../../../abilities/AbilityLearning";

import { getSpellByIdOrAlias, resolveSpellId } from "../../../spells/SpellTypes";
import { findAbilityByNameOrId } from "../../../abilities/AbilityTypes";

type Listed = { id: string; name: string; rank: number; groupId: string };

function norm(x: unknown): string {
  return String(x ?? "").trim().toLowerCase();
}

function fmtPending(items: string[], label: string): string {
  if (!items.length) return `${label}: none.`;
  const lines = items.map((id) => {
    const name =
      label === "Spells"
        ? (getSpellByIdOrAlias(id) as any)?.name
        : (findAbilityByNameOrId(id) as any)?.name;
    return `- ${name ? `${name} ` : ""}(${id})`;
  });
  return `${label} pending training:\n${lines.join("\n")}`;
}

function collectLearnedRankedSpells(char: any): Listed[] {
  const known: Record<string, any> = (char?.spellbook?.known ?? {}) as any;
  const out: Listed[] = [];
  for (const rawId of Object.keys(known)) {
    const canonical = resolveSpellId(rawId) || rawId;
    const def: any = getSpellByIdOrAlias(canonical);
    if (!def) continue;
    const r = Number(def.rank ?? 1);
    if (!Number.isFinite(r) || r <= 1) continue;
    const gid = norm(def.rankGroupId ?? def.id);
    out.push({ id: def.id, name: String(def.name ?? def.id), rank: r, groupId: gid });
  }
  out.sort((a, b) => (b.rank - a.rank) || a.name.localeCompare(b.name));
  return out;
}

function collectLearnedRankedAbilities(char: any): Listed[] {
  const known: Record<string, any> = (char?.abilities?.known ?? {}) as any;
  const out: Listed[] = [];
  for (const rawId of Object.keys(known)) {
    const def: any = findAbilityByNameOrId(rawId);
    if (!def) continue;
    const r = Number(def.rank ?? 1);
    if (!Number.isFinite(r) || r <= 1) continue;
    const gid = norm(def.rankGroupId ?? def.id);
    out.push({ id: def.id, name: String(def.name ?? def.id), rank: r, groupId: gid });
  }
  out.sort((a, b) => (b.rank - a.rank) || a.name.localeCompare(b.name));
  return out;
}

function fmtLearned(items: Listed[], label: string): string {
  if (!items.length) return `${label} learned upgrades: none.`;
  const lines = items.map((x) => `- ${x.name} (rank ${x.rank}) [${x.id}]`);
  return `${label} learned upgrades:\n${lines.join("\n")}`;
}

export async function handleRanksCommand(ctx: MudContext, args: string[]): Promise<string> {
  const char: any = (ctx as any)?.session?.character;
  if (!char) return "You do not have an active character.";

  const sub = norm(args?.[0]);
  const wantsPendingOnly = sub === "pending" || sub === "p";
  const wantsLearnedOnly = sub === "learned" || sub === "known" || sub === "k";

  const pSpells = listPendingSpellsForChar(char);
  const pAbilities = listPendingAbilitiesForChar(char);

  const lSpells = collectLearnedRankedSpells(char);
  const lAbilities = collectLearnedRankedAbilities(char);

  const parts: string[] = [];

  if (!wantsLearnedOnly) {
    if (pSpells.length || pAbilities.length) {
      if (pSpells.length) parts.push(fmtPending(pSpells, "Spells"));
      if (pAbilities.length) parts.push(fmtPending(pAbilities, "Abilities"));
    } else {
      parts.push("Pending training: none.");
    }
  }

  if (!wantsPendingOnly) {
    parts.push(lSpells.length ? fmtLearned(lSpells, "Spells") : "Spells learned upgrades: none.");
    parts.push(lAbilities.length ? fmtLearned(lAbilities, "Abilities") : "Abilities learned upgrades: none.");
  }

  parts.push("Tip: use `train` in town near a trainer to convert pending grants into learned ranks.");

  return parts.join("\n\n");
}
