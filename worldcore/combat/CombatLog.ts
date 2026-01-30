// worldcore/combat/CombatLog.ts
//
// Centralized combat log line formatters.
// Keep these boring and deterministic: contract tests depend on exact shapes.

export function clampInt(n: unknown, min: number, max: number): number {
  const x = Math.floor(Number(n));
  if (!Number.isFinite(x)) return min;
  return Math.min(max, Math.max(min, x));
}

export function formatHpPart(hpAfter?: number, maxHp?: number): string {
  if (typeof hpAfter !== "number" || typeof maxHp !== "number") return "";
  if (!Number.isFinite(hpAfter) || !Number.isFinite(maxHp)) return "";
  const hp = Math.max(0, Math.floor(hpAfter));
  const max = Math.max(1, Math.floor(maxHp));
  return ` (${hp}/${max} HP)`;
}

export function formatWorldSpellDotTickLine(opts: {
  spellName: string;
  targetName: string;
  damage: number;
  hpAfter?: number;
  maxHp?: number;
}): string {
  const spellName = String(opts.spellName || "DOT");
  const targetName = String(opts.targetName || "target");
  const dmg = clampInt(opts.damage, 1, 9_999_999);
  const hpPart = formatHpPart(opts.hpAfter, opts.maxHp);
  return `[world] [spell:${spellName}] ${spellName} deals ${dmg} damage to ${targetName}.${hpPart}`;
}

export function formatWorldSpellHotTickLine(opts: {
  spellName: string;
  targetName: string;
  heal: number;
  hpAfter?: number;
  maxHp?: number;
}): string {
  const spellName = String(opts.spellName || "HOT");
  const targetName = String(opts.targetName || "target");
  const heal = clampInt(opts.heal, 1, 9_999_999);
  const hpPart = formatHpPart(opts.hpAfter, opts.maxHp);
  return `[world] [spell:${spellName}] ${spellName} restores ${heal} health to ${targetName}.${hpPart}`;
}

export function formatWorldSpellDirectDamageLine(opts: {
  spellName: string;
  targetName: string;
  damage: number;
  hpAfter?: number;
  maxHp?: number;
  overkill?: number;
  abilityKind?: "spell" | "song";
}): string {
  const spellName = String(opts.spellName || "Spell");
  const targetName = String(opts.targetName || "target");
  const dmg = clampInt(opts.damage, 0, 9_999_999);
  const overkill = clampInt(opts.overkill ?? 0, 0, 9_999_999);
  const hpPart = formatHpPart(opts.hpAfter, opts.maxHp);

  const kind = opts.abilityKind === "song" ? "song" : "spell";
  const tag = `[world] [${kind}:${spellName}]`;

  let line = `${tag} You hit ${targetName} for ${dmg} damage`;
  if (overkill > 0) line += ` (${overkill} overkill)`;
  line += `.${hpPart}`;
  return line;
}
