// worldcore/songs/MelodyScheduler.ts
//
// Pure-ish melody state machine helpers.
// Split out of SongEngine.ts to isolate scheduling/index logic and make it easy
// to harden with focused tests (no MudContext needed).

export const DEFAULT_MELODY_INTERVAL_MS = 8000; // 8s between song casts by default

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

function asStringArray(v: any): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (typeof x === "string" ? x : String(x ?? "")))
    .map((s) => s.trim())
    .filter(Boolean);
}

export function normalizeMelody(raw: any): MelodyState {
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
  const spellIds = asStringArray((raw as any).spellIds);
  const legacySongIds = asStringArray((raw as any).songIds);

  const playlist = spellIds.length > 0 ? spellIds : legacySongIds;

  const isActive = !!(raw as any).isActive;

  const intervalMs =
    typeof (raw as any).intervalMs === "number" && (raw as any).intervalMs > 0
      ? (raw as any).intervalMs
      : DEFAULT_MELODY_INTERVAL_MS;

  let currentIndex =
    typeof (raw as any).currentIndex === "number" && (raw as any).currentIndex >= 0
      ? (raw as any).currentIndex
      : 0;

  let nextCastAtMs =
    typeof (raw as any).nextCastAtMs === "number" && (raw as any).nextCastAtMs >= 0
      ? (raw as any).nextCastAtMs
      : 0;

  if (!Number.isFinite(currentIndex) || currentIndex < 0) currentIndex = 0;
  if (!Number.isFinite(nextCastAtMs) || nextCastAtMs < 0) nextCastAtMs = 0;

  const m: MelodyState = {
    spellIds: playlist.slice(),
    songIds: playlist.slice(),
    isActive,
    currentIndex,
    nextCastAtMs,
    intervalMs,
  };

  // Keep both keys mirrored for back-compat.
  syncMelodyKeys(m);
  return m;
}

export function syncMelodyKeys(m: MelodyState): void {
  // Keep legacy + canonical keys mirrored so old code/saves don’t explode.
  m.songIds = Array.isArray(m.spellIds) ? m.spellIds.slice() : [];
}

export function getPlaylist(m: MelodyState): string[] {
  const playlist =
    Array.isArray(m.spellIds) && m.spellIds.length > 0
      ? m.spellIds
      : Array.isArray(m.songIds)
        ? (m.songIds as string[])
        : [];

  return Array.isArray(playlist) ? playlist : [];
}

export function clampIndex(m: MelodyState, playlistLen: number): void {
  if (!Number.isFinite(m.currentIndex) || m.currentIndex < 0) m.currentIndex = 0;
  if (playlistLen <= 0) {
    m.currentIndex = 0;
    return;
  }
  if (m.currentIndex >= playlistLen) m.currentIndex = 0;
}

export function currentSpellId(m: MelodyState, playlist: string[]): string | null {
  if (!Array.isArray(playlist) || playlist.length === 0) return null;
  clampIndex(m, playlist.length);
  const id = playlist[m.currentIndex];
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

/**
 * Advance melody state after an attempted tick.
 *
 * Contract: ALWAYS advances index and schedules next cast when called,
 * even if the current spell is invalid/over-level/failed/etc.
 */
export function advanceAndSchedule(m: MelodyState, playlist: string[], nowMs: number): void {
  if (!Array.isArray(playlist) || playlist.length === 0) {
    m.currentIndex = 0;
    m.nextCastAtMs = nowMs + m.intervalMs;
    syncMelodyKeys(m);
    return;
  }

  m.currentIndex = (m.currentIndex + 1) % playlist.length;
  m.nextCastAtMs = nowMs + m.intervalMs;

  // Keep canonical/legacy mirrored
  m.spellIds = playlist.slice();
  syncMelodyKeys(m);
}
