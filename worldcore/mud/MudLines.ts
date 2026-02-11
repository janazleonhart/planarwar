// worldcore/mud/MudLines.ts
//
// Small shared line-formatters for MUD output.
// Keep these intentionally tiny and stable: contract tests may assert exact strings.

export type MudImmuneLineKind = "spell" | "ability" | "world";

/**
 * Canonical formatting for the CC DR immunity message.
 *
 * Spell formatting is intentionally richer (includes spell name) because
 * many world lines in Planar War include the spell header.
 */
export function formatTargetImmuneLine(opts?: { kind?: MudImmuneLineKind; name?: string }): string {
  const kind = opts?.kind ?? "world";
  const name = (opts?.name ?? "").trim();

  if (kind === "spell" && name) {
    return `[world] [spell:${name}] Target is immune.`;
  }

  // NOTE: keep this exact for backwards compatibility with existing tests/output.
  return "[world] Target is immune.";
}
