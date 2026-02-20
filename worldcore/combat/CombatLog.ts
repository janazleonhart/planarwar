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

export function formatDamageExtras(opts: { absorbed?: number; overkill?: number; absorbBreakdown?: { name: string; priority: number; absorbed: number }[] }): string {
  const parts: string[] = [];
  const absorbed = clampInt(opts.absorbed ?? 0, 0, 9_999_999);
  const overkill = clampInt(opts.overkill ?? 0, 0, 9_999_999);
  const breakdown = Array.isArray(opts.absorbBreakdown) ? opts.absorbBreakdown : null;
  if (absorbed > 0) {
    if (breakdown && breakdown.length > 0) {
      const by = breakdown
        .map((b) => {
          const name = String(b?.name ?? "shield");
          const pr = clampInt((b as any)?.priority ?? 0, -99, 99);
          const amt = clampInt((b as any)?.absorbed ?? 0, 0, 9_999_999);
          return `${name}[p${pr}]=${amt}`;
        })
        .join(" > ");
      parts.push(`${absorbed} absorbed by ${by}`);
    } else {
      parts.push(`${absorbed} absorbed`);
    }
  }
  if (overkill > 0) parts.push(`${overkill} overkill`);
  if (parts.length === 0) return "";
  return ` (${parts.join(", ")})`;
}

export function formatWorldSpellDotTickLine(opts: {
  spellName: string;
  targetName: string;
  damage: number;
  absorbed?: number;
  absorbBreakdown?: { name: string; priority: number; absorbed: number }[];
  hpAfter?: number;
  maxHp?: number;
}): string {
  const spellName = String(opts.spellName || "DOT");
  const targetName = String(opts.targetName || "target");
  const dmg = clampInt(opts.damage, 0, 9_999_999);
  const hpPart = formatHpPart(opts.hpAfter, opts.maxHp);
  const extras = formatDamageExtras({ absorbed: opts.absorbed, absorbBreakdown: (opts as any).absorbBreakdown });
  return `[world] [spell:${spellName}] ${spellName} deals ${dmg} damage${extras} to ${targetName}.${hpPart}`;
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
  absorbed?: number;
  absorbBreakdown?: { name: string; priority: number; absorbed: number }[];
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
  line += formatDamageExtras({ absorbed: opts.absorbed, overkill, absorbBreakdown: (opts as any).absorbBreakdown });
  line += `.${hpPart}`;
  return line;
}
