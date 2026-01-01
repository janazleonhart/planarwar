// worldcore/combat/ServiceProtection.ts

/**
 * Service-provider protection rules.
 *
 * These are gameplay rules, not guard/crime rules.
 *
 * Goal: ensure critical town services (mailbox, banker, auctioneer, etc.)
 * cannot be griefed by killing them.
 *
 * How to mark a service provider (recommended):
 *  - Add tags to the NPC prototype: `service_*` (e.g. service_bank, service_mail, service_auction)
 *  - Or add `protected_service`
 *
 * This module intentionally depends on no other project files to avoid
 * circular imports.
 */

export type ProtoLike =
  | {
      id?: string;
      name?: string;
      tags?: string[];
      [k: string]: any;
    }
  | null
  | undefined;

const SERVICE_TAGS = new Set<string>([
  "service",
  "service_provider",
  "protected_service",
  "invulnerable_service",
  "no_attack",
  "no_damage",

  // explicit role-ish tags (friendly for data authors)
  "mailbox",
  "banker",
  "auctioneer",
  "auction_house",
]);

const SERVICE_TAG_PREFIXES = ["service_", "svc_", "invulnerable_"];

const SERVICE_ID_PREFIXES = [
  "service_",
  "svc_",
  "mailbox_",
  "banker_",
  "auctioneer_",
  "auction_",
  "bank_",
  "mail_",
];

function norm(s: any): string {
  return String(s ?? "").toLowerCase().trim();
}

export function isServiceProtectedNpcProto(proto: ProtoLike): boolean {
  if (!proto) return false;

  const id = norm((proto as any).id);
  if (id && SERVICE_ID_PREFIXES.some((p) => id.startsWith(p))) return true;

  const tagsRaw: any = (proto as any).tags;
  const tags = Array.isArray(tagsRaw) ? tagsRaw.map(norm) : [];

  for (const t of tags) {
    if (!t) continue;
    if (SERVICE_TAGS.has(t)) return true;
    if (SERVICE_TAG_PREFIXES.some((p) => t.startsWith(p))) return true;
  }

  return false;
}

/**
 * Entity-level check for protection flags.
 *
 * Convenience hook so a spawn system can directly mark runtime entities
 * without needing to resolve a prototype.
 */
export function isServiceProtectedEntity(ent: any): boolean {
  if (!ent) return false;

  // Explicit runtime flags (future-proof)
  if (
    ent.invulnerable === true ||
    ent.immuneToDamage === true ||
    ent.noDamage === true ||
    ent.noAttack === true ||
    ent.isService === true ||
    ent.isServiceProvider === true ||
    ent.isProtectedService === true
  ) {
    return true;
  }

  const type = norm(ent.type);
  if (
    type === "mailbox" ||
    type === "banker" ||
    type === "auctioneer" ||
    type === "auction_house"
  ) {
    return true;
  }

  const protoId =
    norm(ent.protoId) ||
    norm(ent.templateId) ||
    norm(ent.archetype) ||
    norm(ent.model);

  if (protoId && SERVICE_ID_PREFIXES.some((p) => protoId.startsWith(p))) {
    return true;
  }

  const tagsRaw: any = ent.tags ?? ent.protoTags;
  const tags = Array.isArray(tagsRaw) ? tagsRaw.map(norm) : [];
  for (const t of tags) {
    if (!t) continue;
    if (SERVICE_TAGS.has(t)) return true;
    if (SERVICE_TAG_PREFIXES.some((p) => t.startsWith(p))) return true;
  }

  return false;
}

export function serviceProtectedCombatLine(targetName: string): string {
  const name = targetName || "That target";
  return `[combat] ${name} is protected by city law and cannot be harmed.`;
}
