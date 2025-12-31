// worldcore/actions/ActionTypes.ts

/**
 * World action type definitions and evolution notes.
 *
 * Design goals:
 * - Network-stable, server-authoritative "intent" messages; client animation is derived, not embedded.
 * - Keep a single discriminated union keyed by `kind` for forward compatibility.
 * - Avoid breaking changes; add optional fields or new `kind` members for features.
 *
 * Versioning:
 * - v1: minimal fields, used by MUD and early 2.5D client.
 * - v2+: can add optional metadata (e.g., queueing hints, repeat count) without breaking v1 servers/clients.
 *
 * General resolution rules:
 * - If both `targetId` and `targetName` are present, `targetId` MUST take precedence.
 * - `targetId` refers to a server-issued entity identifier (string/UUID); format is opaque to clients.
 * - `targetName` is a user-entered, case-insensitive, room-scoped fuzzy/partial name ("rat", "ore").
 * - Ambiguous `targetName` should yield an "AmbiguousTarget" style error or a disambiguation list (server policy).
 * - Missing both `targetId` and `targetName` should yield a "BadRequest" style error.
 *
 * Server guarantees and expectations:
 * - Server validates actor permissions, range, cooldowns, resources, and tool/weapon requirements.
 * - Server may auto-approach/pathfind if policy allows; otherwise returns "OutOfRange".
 * - Unknown extra fields should be ignored (forward compatibility), unless in strict mode.
 * - All actions are non-idempotent intents; clients should debounce or respect cooldowns to avoid spam.
 *
 * Error surface (indicative, not exhaustive):
 * - NotFound, AmbiguousTarget, OutOfRange, NotPermitted, OnCooldown, LackingResources, InvalidChannel,
 *   RequiresTool, RequiresLineOfSight, EnvironmentBlocked.
 */
export type AttackChannel =
  /**
   * "weapon" = physical/melee/ranged attack using currently equipped or default weapon.
   * - Includes "unarmed" fallback if no weapon equipped (server policy).
   * - Consumes stamina/weapon durability if applicable.
   */
  | "weapon"
  /**
   * "spell" = offensive spellcasting route.
   * - Requires known/prepared spell (server selects default/basic attack if multiple aren't specified, server policy).
   * - Consumes mana/focus and respects spell schools, silence effects, etc.
   */
  | "spell"
  /**
   * "ability" = class/skill ability route (e.g., "Power Strike").
   * - Server resolves to a default/basic offensive ability when unspecified (policy-dependent).
   * - Consumes appropriate resources and respects global cooldown (GCD) and specific cooldowns.
   */
  | "ability";

/**
 * Generic attack request.
 *
 * v1 usage (MUD + 2.5D client):
 * - `channel` is mandatory and indicates routing (weapon/spell/ability).
 * - Provide either `targetId` (preferred) or `targetName` for in-room resolution.
 *
 * Resolution/precedence:
 * - `targetId` > `targetName`.
 * - `targetName` resolution is room/visibility scoped and case-insensitive; partial matches allowed by server policy.
 *
 * Range and movement:
 * - Server may path the actor into range if allowed; otherwise returns "OutOfRange".
 *
 * Cooldowns and rate limiting:
 * - Subject to GCD and per-channel cooldowns; repeated sends enqueue or fail per server policy.
 *
 * Failure examples:
 * - InvalidChannel, NotFound/AmbiguousTarget, OnCooldown, LackingResources, NotPermitted, RequiresLineOfSight.
 *
 * v2 candidates (do not send yet):
 * - queue?: boolean — request queueing behind current action.
 * - repeat?: number — repeat count for auto-attack loops.
 * - assistTargetId?: string — assist another entity's current target.
 */
export interface AttackActionRequest {
  kind: "attack";
  channel: AttackChannel;
  /**
   * Human-friendly/loose target ("rat"), resolved within current room/visibility.
   * Use only when `targetId` is unknown. Case-insensitive; partial matches allowed (server policy).
   */
  targetName?: string;
  /**
   * Exact server entity id. If present, MUST be used over `targetName`.
   * Opaque format (UUID/string); clients should not infer semantics from its shape.
   */
  targetId?: string;
}

/**
 * Generic harvest / gathering request.
 *
 * v1 usage:
 * - Provide `targetId` when known to avoid ambiguity; otherwise use `targetName` with optional `resourceType` hint.
 *
 * resourceType semantics:
 * - Acts as a hint/filter for server disambiguation and validation (tool checks, biome restrictions).
 * - Not strictly required; if omitted, server infers from target entity when possible.
 *
 * Typical behaviors:
 * - May trigger auto-approach/pathing to the resource node.
 * - May require tools (pickaxe for ore, hatchet for wood, etc.); server validates.
 *
 * Failure examples:
 * - NotFound/AmbiguousTarget, RequiresTool, OutOfRange, NotPermitted, OnCooldown, EnvironmentBlocked.
 *
 * v2 candidates (do not send yet):
 * - quantity?: number — request multiple gathers if node supports batching.
 * - autoRepeat?: boolean — continue until node depleted or interrupted.
 */
export interface HarvestActionRequest {
  kind: "harvest";
  /**
   * Optional hint to disambiguate or pre-validate required tools.
   * Future expansions may include: "stone", "hide", "fiber", etc. Keep unknowns ignored by server.
   */
  resourceType?: "ore" | "herb" | "wood" | "fish";
  /**
   * Loose target name ("ore vein", "oak", "fishing spot"), room/visibility-scoped.
   */
  targetName?: string;
  /**
   * Exact server entity id (preferred when available).
   */
  targetId?: string;
}

/**
 * All supported world action requests.
 *
 * v1: attack + harvest only.
 * Future additions should:
 * - Add a new discriminant `kind` value (e.g., "interact", "use_item", "cast_spell", "ability").
 * - Keep new fields optional where possible for backward compatibility.
 * - Avoid reusing `kind` with incompatible semantics.
 *
 * Client guidance:
 * - Always switch on `kind` and handle unknown values defensively (log + ignore or send generic "interact").
 */
export type ActionRequest = AttackActionRequest | HarvestActionRequest;