// worldcore/songs/SongEngine.ts

import type { CharacterState } from "../characters/CharacterTypes";
import type { MudContext } from "../mud/MudContext";

import { SPELLS, type SpellDefinition, ensureSpellbookAutogrants } from "../spells/SpellTypes";
import { castSpellForCharacter } from "../mud/MudSpells";
import { Logger } from "../utils/logger";

import {
  type MelodyState,
  DEFAULT_MELODY_INTERVAL_MS,
  normalizeMelody,
  syncMelodyKeys,
  getPlaylist,
  currentSpellId,
  advanceAndSchedule,
} from "./MelodyScheduler";

const log = Logger.scope("SONGS");

export { DEFAULT_MELODY_INTERVAL_MS };
export type { MelodyState };

export interface SongsState {
  melody: MelodyState;
}

function ensureProgression(char: CharacterState): any {
  const anyChar: any = char as any;

  if (!anyChar.progression || typeof anyChar.progression !== "object") {
    anyChar.progression = {};
  }

  const prog = anyChar.progression as any;

  if (!prog.songs) {
    prog.songs = {};
  }

  return prog;
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

/**
 * Replace the entire melody playlist.
 * Canonical key is spellIds (legacy songIds is mirrored for back-compat).
 */
export function setMelody(char: CharacterState, spellIds: string[]): MelodyState {
  const songs = getSongsState(char);
  songs.melody = normalizeMelody({
    ...songs.melody,
    spellIds: Array.isArray(spellIds) ? spellIds : [],
    currentIndex: 0,
    nextCastAtMs: 0,
    intervalMs:
      typeof songs.melody.intervalMs === "number" && songs.melody.intervalMs > 0
        ? songs.melody.intervalMs
        : DEFAULT_MELODY_INTERVAL_MS,
  });

  syncMelodyKeys(songs.melody);
  return songs.melody;
}

/**
 * Back-compat helper used by melodyCommand.ts.
 * Adds a song id to the melody playlist (no-op if already present).
 */
export function addSongToMelody(char: CharacterState, spellId: string): MelodyState {
  const melody = getMelody(char);
  const id = String(spellId ?? "").trim();
  if (!id) return melody;

  const playlist = getPlaylist(melody);

  // v0 policy: avoid duplicates to prevent accidental spam.
  // (If you want duplicates later, flip this and add a contract test.)
  if (!playlist.includes(id)) playlist.push(id);

  return setMelody(char, playlist);
}

/**
 * Back-compat helper used by melodyCommand.ts.
 * Removes the first occurrence of a song id from the melody playlist.
 */
export function removeSongFromMelody(char: CharacterState, spellId: string): MelodyState {
  const melody = getMelody(char);
  const id = String(spellId ?? "").trim();
  if (!id) return melody;

  const playlist = getPlaylist(melody);
  const idx = playlist.indexOf(id);
  if (idx >= 0) playlist.splice(idx, 1);

  return setMelody(char, playlist);
}

/**
 * Back-compat helper used by melodyCommand.ts.
 * Clears the melody playlist and stops playback.
 */
export function clearMelody(char: CharacterState): MelodyState {
  const melody = setMelody(char, []);
  melody.isActive = false;
  melody.currentIndex = 0;
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

export type SongCaster = (
  ctx: MudContext,
  char: CharacterState,
  spell: SpellDefinition,
  targetNameRaw?: string,
) => Promise<string>;

/**
 * Song tick:
 * - Only applies to Virtuoso (for now).
 * - Only runs if melody.isActive and there are songs in the playlist.
 * - Uses the main spell cast path so cooldowns, mana, damage, etc. are consistent.
 *
 * Returns the result string from casting (or null if no cast happened).
 */
// CRITICAL PATH: TickEngine -> SongEngine -> melody auto-cast.
export async function tickSongsForCharacter(
  ctx: MudContext,
  char: CharacterState,
  nowMs: number,
  caster: SongCaster = castSpellForCharacter,
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

  const playlist = getPlaylist(melody);
  if (!Array.isArray(playlist) || playlist.length === 0) return null;

  const spellId = currentSpellId(melody, playlist);
  if (!spellId) return null;

  const spell: SpellDefinition | undefined = SPELLS[spellId];

  let result: string | null = null;

  try {
    if (spell && spell.isSong === true && (spell.classId ?? "").toLowerCase() === "virtuoso") {
      // Even if the song is over-level / not learned / on cooldown / out of mana,
      // the cast path will return a string gate message (and we still advance).
      const r = await caster(ctx, char, spell, undefined);
      result = typeof r === "string" ? r : null;
    } else {
      // Unknown or non-song ids should not crash melody. We simply skip them.
      result = null;
    }
  } catch (err: any) {
    log.warn("Error during song tick cast", {
      charId: (char as any).id,
      spellId,
      error: String(err),
    });
    result = null;
  } finally {
    // Always advance + schedule next tick — this is a key contract.
    advanceAndSchedule(melody, playlist, nowMs);
  }

  return result;
}
