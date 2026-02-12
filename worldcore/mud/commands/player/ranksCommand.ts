// worldcore/mud/commands/player/ranksCommand.ts
//
// Spell + Ability Rank System
//
// "ranks" / "rank" is an informational command:
// - List mode: shows pending grants (things you can train) + learned higher-rank upgrades.
// - Detail mode: `ranks <spellId|abilityId>` shows the rank chain, next-rank suggestion,
//   and best-effort sources (env-configured boss drops are supported in tests).
//
// Learning (converting pending -> learned) is handled by trainCommand.ts

import type { MudContext } from "../../MudContext";

import { listPendingSpellsForChar } from "../../../spells/SpellLearning";
import { listPendingAbilitiesForChar } from "../../../abilities/AbilityLearning";

import { SPELLS, getSpellByIdOrAlias, resolveSpellId } from "../../../spells/SpellTypes";
import { ABILITIES, findAbilityByNameOrId } from "../../../abilities/AbilityTypes";

import { listBossDropSourcesForSpellId, listBossDropSourcesForAbilityId } from "../../../ranks/RankBossDropGrantService";

type Listed = { id: string; name: string; rank: number; groupId: string };

function norm(x: unknown): string {
  return String(x ?? "").trim().toLowerCase();
}

function percent(chance: number): string {
  const n = Number(chance);
  if (!Number.isFinite(n)) return "0%";
  return `${Math.round(Math.max(0, Math.min(1, n)) * 100)}%`;
}

function fmtPending(items: string[], label: "Spells" | "Abilities"): string {
  if (!items.length) return `${label}: none.`;
  const lines = items.map((id) => {
    const name =
      label === "Spells"
        ? (getSpellByIdOrAlias(id) as any)?.name
        : (findAbilityByNameOrId(id) as any)?.name;
    return `- ${name ? `${name} ` : ""}[${id}]`;
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
  out.sort((a, b) => b.rank - a.rank || a.name.localeCompare(b.name));
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
  out.sort((a, b) => b.rank - a.rank || a.name.localeCompare(b.name));
  return out;
}

function fmtLearned(items: Listed[], label: "Spells" | "Abilities"): string {
  if (!items.length) return `${label} learned upgrades: none.`;
  const lines = items.map((x) => `- ${x.name} (rank ${x.rank}) [${x.id}]`);
  return `${label} learned upgrades:\n${lines.join("\n")}`;
}

function isLearned(char: any, kind: "spell" | "ability", id: string): boolean {
  if (kind === "spell") return Boolean(char?.spellbook?.known?.[id]);
  return Boolean(char?.abilities?.known?.[id]);
}

function isPending(char: any, kind: "spell" | "ability", id: string): boolean {
  if (kind === "spell") return Boolean(char?.spellbook?.pending?.[id]);
  return Boolean(char?.abilities?.pending?.[id]);
}

function collectSpellChain(groupId: string): Array<{ id: string; name: string; rank: number }> {
  const gid = norm(groupId);
  const out: Array<{ id: string; name: string; rank: number }> = [];
  for (const def of Object.values(SPELLS as any)) {
    const d: any = def;
    if (!d?.id) continue;
    const g = norm(d.rankGroupId ?? d.id);
    if (g !== gid) continue;
    const r = Number(d.rank ?? 1);
    out.push({ id: String(d.id), name: String(d.name ?? d.id), rank: Number.isFinite(r) ? r : 1 });
  }
  out.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
  return out;
}

function collectAbilityChain(groupId: string): Array<{ id: string; name: string; rank: number }> {
  const gid = norm(groupId);
  const out: Array<{ id: string; name: string; rank: number }> = [];
  for (const def of Object.values(ABILITIES as any)) {
    const d: any = def;
    if (!d?.id) continue;
    const g = norm(d.rankGroupId ?? d.id);
    if (g !== gid) continue;
    const r = Number(d.rank ?? 1);
    out.push({ id: String(d.id), name: String(d.name ?? d.id), rank: Number.isFinite(r) ? r : 1 });
  }
  out.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
  return out;
}

async function fmtBossDropSources(kind: "spell" | "ability", targetId: string): Promise<string | null> {
  if (!targetId) return null;

  if (kind === "spell") {
    const { sources, usedEnvRules } = await listBossDropSourcesForSpellId(targetId);
    if (!sources.length) return null;
    const label = usedEnvRules ? "Boss drops (env)" : "Boss drops";
    const parts = sources.map((s) => `${s.npcProtoId} (${percent(s.chance)})`);
    return `${label}: ${parts.join(", ")}`;
  }

  const { sources, usedEnvRules } = await listBossDropSourcesForAbilityId(targetId);
  if (!sources.length) return null;
  const label = usedEnvRules ? "Boss drops (env)" : "Boss drops";
  const parts = sources.map((s) => `${s.npcProtoId} (${percent(s.chance)})`);
  return `${label}: ${parts.join(", ")}`;
}

async function handleDetail(ctx: MudContext, char: any, rawId: string): Promise<string> {
  const spellId = resolveSpellId(rawId) || rawId;
  const spellDef: any = getSpellByIdOrAlias(spellId);
  const abilityDef: any = !spellDef ? findAbilityByNameOrId(rawId) : null;

  if (!spellDef && !abilityDef) {
    return `Unknown spell/ability: ${rawId}`;
  }

  const parts: string[] = [];

  if (spellDef) {
    const baseGroup = String(spellDef.rankGroupId ?? spellDef.id);
    const chain = collectSpellChain(baseGroup);

    parts.push(`Spell: ${spellDef.name ?? spellDef.id} [${spellDef.id}]`);
    parts.push("Spell rank chain:");

    for (const c of chain) {
      const badge = isPending(char, "spell", c.id)
        ? " (pending)"
        : isLearned(char, "spell", c.id)
          ? " (learned)"
          : "";
      parts.push(`- Rank ${c.rank}: ${c.name} [${c.id}]${badge}`);
    }

    // Next rank = lowest rank > highest learned.
    let learnedMax = 0;
    for (const c of chain) if (isLearned(char, "spell", c.id)) learnedMax = Math.max(learnedMax, c.rank);
    const next = chain.find((c) => c.rank === learnedMax + 1) ?? chain.find((c) => c.rank > learnedMax);

    if (next) {
      parts.push("");
      parts.push(`Next rank: Rank ${next.rank} — ${next.name} [${next.id}]`);
    }

    // Source hint: prefer next rank (what you want), else the highest rank in chain.
    const sourceId = next?.id ?? chain[chain.length - 1]?.id ?? spellDef.id;
    const src = await fmtBossDropSources("spell", sourceId);
    parts.push("");
    parts.push(src ? `Sources: ${src}` : "Sources: unknown (not configured / not queryable)." );

    parts.push("");
    parts.push("Tip: use `train` in town near a trainer to convert pending grants into learned ranks.");

    return parts.join("\n");
  }

  // Ability detail
  const baseGroup = String(abilityDef.rankGroupId ?? abilityDef.id);
  const chain = collectAbilityChain(baseGroup);

  parts.push(`Ability: ${abilityDef.name ?? abilityDef.id} [${abilityDef.id}]`);
  parts.push("Ability rank chain:");

  for (const c of chain) {
    const badge = isPending(char, "ability", c.id)
      ? " (pending)"
      : isLearned(char, "ability", c.id)
        ? " (learned)"
        : "";
    parts.push(`- Rank ${c.rank}: ${c.name} [${c.id}]${badge}`);
  }

  let learnedMax = 0;
  for (const c of chain) if (isLearned(char, "ability", c.id)) learnedMax = Math.max(learnedMax, c.rank);
  const next = chain.find((c) => c.rank === learnedMax + 1) ?? chain.find((c) => c.rank > learnedMax);

  if (next) {
    parts.push("");
    parts.push(`Next rank: Rank ${next.rank} — ${next.name} [${next.id}]`);
  }

  const sourceId = next?.id ?? chain[chain.length - 1]?.id ?? abilityDef.id;
  const src = await fmtBossDropSources("ability", sourceId);
  parts.push("");
  parts.push(src ? `Sources: ${src}` : "Sources: unknown (not configured / not queryable)." );

  parts.push("");
  parts.push("Tip: use `train` in town near a trainer to convert pending grants into learned ranks.");

  return parts.join("\n");
}

export async function handleRanksCommand(ctx: MudContext, args: string[]): Promise<string> {
  const char: any = (ctx as any)?.session?.character;
  if (!char) return "You do not have an active character.";

  const first = norm(args?.[0]);

  // Detail mode: ranks <id> where <id> is not a list-mode selector.
  if (first && first !== "pending" && first !== "p" && first !== "learned" && first !== "known" && first !== "k") {
    return handleDetail(ctx, char, String(args[0]));
  }

  const wantsPendingOnly = first === "pending" || first === "p";
  const wantsLearnedOnly = first === "learned" || first === "known" || first === "k";

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
