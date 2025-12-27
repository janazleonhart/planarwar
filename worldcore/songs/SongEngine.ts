// worldcore/songs/SongEngine.ts

import type { CharacterState } from "../characters/CharacterTypes";
import type { MudContext } from "../mud/MudContext";

import {
  SPELLS,
  type SpellDefinition,
} from "../spells/SpellTypes";

import { castSpellForCharacter } from "../mud/MudSpells";
import { Logger } from "../utils/logger";

const log = Logger.scope("SONGS");

const DEFAULT_MELODY_INTERVAL_MS = 8000; // 8s between song casts by default

export interface MelodyState {
  // ordered list of song spellIds to cycle through
  spellIds: string[];

  // whether the melody should currently be playing
  isActive: boolean;

  // index into spellIds
  currentIndex: number;

  // next time (ms since epoch) when a song may be auto-cast
  nextCastAtMs: number;

  // cadence between song casts
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

function normalizeMelody(raw: any): MelodyState {
  if (!raw || typeof raw !== "object") {
    return {
      spellIds: [],
      isActive: false,
      currentIndex: 0,
      nextCastAtMs: 0,
      intervalMs: DEFAULT_MELODY_INTERVAL_MS,
    };
  }

  const spellIds = Array.isArray(raw.spellIds) ? raw.spellIds.slice() : [];
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
  if (spellIds.length === 0) {
    currentIndex = 0;
  } else if (currentIndex >= spellIds.length) {
    currentIndex = 0;
  }

  return {
    spellIds,
    isActive,
    currentIndex,
    nextCastAtMs,
    intervalMs,
  };
}

export function getSongsState(char: CharacterState): SongsState {
  const prog = ensureProgression(char);

  if (!prog.songs) {
    prog.songs = {};
  }

  // Normalize melody state
  prog.songs.melody = normalizeMelody(prog.songs.melody);

  return prog.songs as SongsState;
}

export function getMelody(char: CharacterState): MelodyState {
  return getSongsState(char).melody;
}

export function setMelody(
  char: CharacterState,
  spellIds: string[]
): MelodyState {
  const songs = getSongsState(char);
  songs.melody = normalizeMelody({
    ...songs.melody,
    spellIds: spellIds.slice(),
    currentIndex: 0,
    // reset timing so it fires again on next tick
    nextCastAtMs: 0,
  });
  return songs.melody;
}

export function addSongToMelody(
  char: CharacterState,
  spellId: string
): MelodyState {
  const melody = getMelody(char);

  if (!melody.spellIds.includes(spellId)) {
    melody.spellIds.push(spellId);
  }

  // Reset index and timing so we restart cleanly
  melody.currentIndex = 0;
  melody.nextCastAtMs = 0;

  return melody;
}

export function removeSongFromMelody(
  char: CharacterState,
  spellId: string
): MelodyState {
  const melody = getMelody(char);

  melody.spellIds = melody.spellIds.filter((id) => id !== spellId);

  if (melody.currentIndex >= melody.spellIds.length) {
    melody.currentIndex = 0;
  }

  // If no songs remain, auto-stop
  if (melody.spellIds.length === 0) {
    melody.isActive = false;
  }

  melody.nextCastAtMs = 0;

  return melody;
}

export function clearMelody(char: CharacterState): MelodyState {
  const melody = getMelody(char);
  melody.spellIds = [];
  melody.currentIndex = 0;
  melody.isActive = false;
  melody.nextCastAtMs = 0;
  return melody;
}

export function setMelodyActive(
  char: CharacterState,
  active: boolean
): MelodyState {
  const melody = getMelody(char);
  melody.isActive = active;

  // When starting, schedule immediately on next tick
  if (active) {
    melody.nextCastAtMs = 0;
  }

  return melody;
}

/**
 * Song tick:
 * - Only applies to Virtuoso (for now).
 * - Only runs if melody.isActive and there are valid songs.
 * - Uses the main spell cast path so cooldowns, mana, damage, etc. are consistent.
 *
 * Returns the result string from casting (or null if no cast happened).
 */
export async function tickSongsForCharacter(
  ctx: MudContext,
  char: CharacterState,
  nowMs: number
): Promise<string | null> {
  const classId = (char.classId ?? "").toLowerCase();
  if (classId !== "virtuoso") return null;

  const melody = getMelody(char);

  if (!melody.isActive) return null;
  if (!Array.isArray(melody.spellIds) || melody.spellIds.length === 0) {
    return null;
  }

  // Not time yet?
  if (nowMs < melody.nextCastAtMs) return null;

  // Resolve melody spell list to actual, valid Virtuoso songs
  const songSpells: SpellDefinition[] = melody.spellIds
    .map((id) => SPELLS[id])
    .filter(
      (s): s is SpellDefinition =>
        !!s &&
        s.isSong === true &&
        (s.classId ?? "").toLowerCase() === "virtuoso"
    );

  if (songSpells.length === 0) {
    // Nothing valid left; clean up
    melody.spellIds = [];
    melody.currentIndex = 0;
    melody.isActive = false;
    return null;
  }

  // Clamp index
  if (melody.currentIndex < 0 || melody.currentIndex >= songSpells.length) {
    melody.currentIndex = 0;
  }

  const spell = songSpells[melody.currentIndex];

  try {
    const result = await castSpellForCharacter(ctx, char, spell, undefined);

    // Advance index regardless of success/failure (keeps melody flowing)
    melody.currentIndex = (melody.currentIndex + 1) % songSpells.length;

    // Schedule next cast
    melody.nextCastAtMs = nowMs + melody.intervalMs;

    return result;
  } catch (err: any) {
    log.warn("Error during song tick cast", {
      charId: char.id,
      spellId: spell.id,
      error: String(err),
    });

    // Back off slightly on error so we don't spam
    melody.nextCastAtMs = nowMs + melody.intervalMs;
    melody.currentIndex = (melody.currentIndex + 1) % songSpells.length;
    return null;
  }
}
