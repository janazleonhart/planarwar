//worldcore/characters/Leveling.ts

export interface LevelingResult {
    oldLevel: number;
    newLevel: number;
    oldXp: number;
    newXp: number;
    leveledUp: boolean;
  }
  
  export function xpForNextLevel(level: number): number {
    // simple starter curve (replace later)
    // L1->2: 100, L2->3: 200, etc.
    return Math.max(100, level * 100);
  }
  
  export function applyXp(oldLevel: number, oldXp: number, deltaXp: number): LevelingResult {
    let level = oldLevel;
    let xp = Math.max(0, oldXp + deltaXp);
  
    while (xp >= xpForNextLevel(level)) {
      xp -= xpForNextLevel(level);
      level += 1;
    }
  
    return {
      oldLevel,
      newLevel: level,
      oldXp,
      newXp: xp,
      leveledUp: level !== oldLevel,
    };
  }
  