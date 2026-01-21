// worldcore/songs/SongEngine.ts

import type { CharacterState } from "../characters/CharacterTypes";
import type { MudContext } from "../mud/MudContext";

import { SPELLS, type SpellDefinition, ensureSpellbookAutogrants } from "../spells/SpellTypes";
import { castSpellForCharacter } from "../mud/MudSpells";
import { Logger } from "../utils/logger";

const log = Logger.scope("SONGS");

const DEFAULT_MELODY_INTERVAL_MS = 8000; // 8s between song casts by default

export interface MelodyState {
  /**
   * Canonical playlist key going forward.
   * Ordered list of song spellIds to cycle through.
   */
  spellIds: string[];

  /**
   * Legacy/back-compat (older saves / older code).
   * Kept optional so TS doesn't complain, but we normalize to spellIds.
   */
  songIds?: string[];

  isActive: boolean;
  currentIndex: number;
  nextCastAtMs: number;
  intervalMs: number;
}

export interface SongsState {
  melody: MelodyState;
}

function ensureProgression(char: CharacterState): any {
  const prog: any = char.progression || {};
  if (!prog.songs) {
    prog.songs = {};
    char.progression = prog;
  }
  return prog;
}

function asStringArray(v: any): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x) => typeof x === "string").map((s) => s.trim()).filter(Boolean);
}

function normalizeMelody(raw: any): MelodyState {
  if (!raw || typeof raw !== "object") {
    return {
      spellIds: [],
      songIds: [],
      isActive: false,
      currentIndex: 0,
      nextCastAtMs: 0,
      intervalMs: DEFAULT_MELODY_INTERVAL_MS,
    };
  }

  // Accept either key; spellIds is canonical.
  const spellIds = asStringArray(raw.spellIds);
  const legacySongIds = asStringArray(raw.songIds);

  const playlist = spellIds.length > 0 ? spellIds : legacySongIds;

  const isActive = !!raw.isActive;

  const intervalMs =
    typeof raw.intervalMs === "number" && raw.intervalMs > 0
      ? raw.intervalMs
      : DEFAULT_MELODY_INTERVAL_MS;

  let currentIndex =
    typeof raw.currentIndex === "number" && raw.currentIndex >= 0
      ? raw.currentIndex
      : 0;

  let nextCastAtMs =
    typeof raw.nextCastAtMs === "number" && raw.nextCastAtMs >= 0
      ? raw.nextCastAtMs
      : 0;

  // Clamp index if it drifted past the list
  if (playlist.length === 0) {
    currentIndex = 0;
  } else if (currentIndex >= playlist.length) {
    currentIndex = 0;
  }

  return {
    spellIds: playlist.slice(),
    songIds: playlist.slice(), // keep both in sync for old readers
    isActive,
    currentIndex,
    nextCastAtMs,
    intervalMs,
  };
}

function syncMelodyKeys(m: MelodyState): void {
  // Keep legacy + canonical keys mirrored so old code/saves don’t explode.
  m.songIds = Array.isArray(m.spellIds) ? m.spellIds.slice() : [];
}

export function getSongsState(char: CharacterState): SongsState {
  const prog = ensureProgression(char);

  if (!prog.songs) prog.songs = {};

  prog.songs.melody = normalizeMelody(prog.songs.melody);

  // Ensure both keys exist + are synced
  syncMelodyKeys(prog.songs.melody);

  return prog.songs as SongsState;
}

export function getMelody(char: CharacterState): MelodyState {
  return getSongsState(char).melody;
}

export function setMelody(char: CharacterState, spellIds: string[]): MelodyState {
  const songs = getSongsState(char);
  songs.melody = normalizeMelody({
    ...songs.melody,
    spellIds: asStringArray(spellIds),
    currentIndex: 0,
    nextCastAtMs: 0, // fire next tick
  });
  syncMelodyKeys(songs.melody);
  return songs.melody;
}

export function addSongToMelody(char: CharacterState, spellId: string): MelodyState {
  const melody = getMelody(char);
  const id = String(spellId ?? "").trim();
  if (!id) return melody;

  if (!melody.spellIds.includes(id)) {
    melody.spellIds.push(id);
  }

  melody.currentIndex = 0;
  melody.nextCastAtMs = 0;

  syncMelodyKeys(melody);
  return melody;
}

export function removeSongFromMelody(char: CharacterState, spellId: string): MelodyState {
  const melody = getMelody(char);
  const id = String(spellId ?? "").trim();
  if (!id) return melody;

  melody.spellIds = melody.spellIds.filter((x) => x !== id);

  if (melody.spellIds.length === 0) {
    melody.currentIndex = 0;
    melody.isActive = false;
    melody.nextCastAtMs = 0;
    syncMelodyKeys(melody);
    return melody;
  }

  if (melody.currentIndex >= melody.spellIds.length) {
    melody.currentIndex = 0;
  }

  melody.nextCastAtMs = 0;
  syncMelodyKeys(melody);
  return melody;
}

export function clearMelody(char: CharacterState): MelodyState {
  const melody = getMelody(char);
  melody.spellIds = [];
  melody.currentIndex = 0;
  melody.isActive = false;
  melody.nextCastAtMs = 0;
  syncMelodyKeys(melody);
  return melody;
}

export function setMelodyActive(char: CharacterState, active: boolean): MelodyState {
  const melody = getMelody(char);
  melody.isActive = active;

  // When starting, schedule immediately on next tick
  if (active) melody.nextCastAtMs = 0;

  syncMelodyKeys(melody);
  return melody;
}

/**
 * Song tick:
 * - Only applies to Virtuoso (for now).
 * - Only runs if melody.isActive and there are songs in the playlist.
 * - Uses the main spell cast path so cooldowns, mana, damage, etc. are consistent.
 *
 * Returns the result string from casting (or null if no cast happened).
 */
// CRITICAL PATH: TickEngine -> SongEngine -> melody auto-cast.
// Do not rename or change its input/output contract in bulk refactors.
export async function tickSongsForCharacter(
  ctx: MudContext,
  char: CharacterState,
  nowMs: number,
): Promise<string | null> {
  // Hard safety guard: no songs without a living entity
  const ent = ctx.entities?.getEntityByOwner(ctx.session.id);
  const hp = ent && typeof (ent as any).hp === "number" ? (ent as any).hp : undefined;
  const aliveFlag = ent && typeof (ent as any).alive === "boolean" ? (ent as any).alive : undefined;

  if (!ent || hp === 0 || (typeof hp === "number" && hp < 0) || aliveFlag === false) {
    setMelodyActive(char, false);
    return null;
  }

  const classId = (char.classId ?? "").toLowerCase();
  if (classId !== "virtuoso") return null;

  // Keep spellbook hydrated so the cast path can apply normal gates.
  ensureSpellbookAutogrants(char);

  const melody = getMelody(char);

  if (!melody.isActive) return null;

  // Respect timing
  if (nowMs < melody.nextCastAtMs) return null;

  // Prefer canonical, but accept legacy
  const playlist = (Array.isArray(melody.spellIds) && melody.spellIds.length > 0
    ? melody.spellIds
    : Array.isArray(melody.songIds)
      ? melody.songIds
      : []) as string[];

  if (!Array.isArray(playlist) || playlist.length === 0) return null;

  // Clamp index into playlist length
  if (!Number.isFinite(melody.currentIndex) || melody.currentIndex < 0) melody.currentIndex = 0;
  if (melody.currentIndex >= playlist.length) melody.currentIndex = 0;

  const spellId = playlist[melody.currentIndex];
  const spell: SpellDefinition | undefined = SPELLS[spellId];

  let result: string | null = null;

  try {
    if (spell && spell.isSong === true && (spell.classId ?? "").toLowerCase() === "virtuoso") {
      // Even if the song is over-level / not learned / on cooldown / out of mana,
      // castSpellForCharacter will return a string gate message (and we still advance).
      const r = await castSpellForCharacter(ctx, char, spell, undefined);
      result = (typeof r === "string" ? r : null);
    } else {
      // Unknown or non-song ids should not crash melody. We simply skip them.
      // (We *don't* prune the whole playlist here, because tests expect index advancement behavior.)
      result = null;
    }
  } catch (err: any) {
    log.warn("Error during song tick cast", {
      charId: char.id,
      spellId,
      error: String(err),
    });
    result = null;
  } finally {
    // Always advance + schedule next tick — this is the key contract the test enforces.
    melody.currentIndex = (melody.currentIndex + 1) % playlist.length;
    melody.nextCastAtMs = nowMs + melody.intervalMs;

    // Keep canonical/legacy mirrored
    melody.spellIds = playlist.slice();
    syncMelodyKeys(melody);
  }

  return result;
}
