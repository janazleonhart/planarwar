// worldcore/combat/StatusStackingPolicy.ts
//
// Status stacking policies define how repeated applications of the same stacking group behave.

export type StatusStackingPolicy =
  // One instance per stacking group; reapply adds stacks and extends expiry to the later of existing and new.
  | "legacy_add"
  // One instance; reapply refreshes duration but does not increase stacks.
  | "refresh"
  // One instance; reapply replaces the whole instance (payload and expiry) with the new one.
  | "overwrite"
  // One instance; if present, reapply is denied (useful for "can't re-apply" locks).
  | "deny_if_present"
  // One instance; reapply adds stacks and refreshes duration.
  | "stack_add"
  // Multiple instances, keyed by (appliedById, versionKey). Intended for multi-caster DOTs.
  | "versioned_by_applier";

export function isStatusStackingPolicy(v: unknown): v is StatusStackingPolicy {
  return (
    v === "legacy_add" ||
    v === "refresh" ||
    v === "overwrite" ||
    v === "deny_if_present" ||
    v === "stack_add" ||
    v === "versioned_by_applier"
  );
}

export function resolveStatusStackingPolicy(
  v: unknown,
  fallback: StatusStackingPolicy,
): StatusStackingPolicy {
  return isStatusStackingPolicy(v) ? v : fallback;
}
