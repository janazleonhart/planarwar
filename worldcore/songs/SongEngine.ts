// worldcore/songs/SongEngine.ts

import type { CharacterState } from "../characters/CharacterTypes";

export interface MelodyState {
  // ordered list of spellIds (song spells) to cycle through
  spellIds: string[];

  // whether the melody should currently be playing
  isActive: boolean;
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

export function getSongsState(char: CharacterState): SongsState {
  const prog = ensureProgression(char);

  if (!prog.songs.melody) {
    prog.songs.melody = {
      spellIds: [],
      isActive: false,
    } as MelodyState;
  }

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
  songs.melody.spellIds = spellIds;
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

  return melody;
}

export function removeSongFromMelody(
  char: CharacterState,
  spellId: string
): MelodyState {
  const melody = getMelody(char);
  melody.spellIds = melody.spellIds.filter((id) => id !== spellId);
  return melody;
}

export function clearMelody(char: CharacterState): MelodyState {
  const melody = getMelody(char);
  melody.spellIds = [];
  melody.isActive = false;
  return melody;
}

export function setMelodyActive(
  char: CharacterState,
  active: boolean
): MelodyState {
  const melody = getMelody(char);
  melody.isActive = active;
  return melody;
}
