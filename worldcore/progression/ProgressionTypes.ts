// worldcore/progression/ProgressionTypes.ts

// Simple bounded resource like mana, fury, stamina, etc.
export interface PowerResourceState {
    current: number;
    max: number;
  }
  
  // Cooldown state for abilities/spells/etc.
  export interface AbilityCooldownState {
    readyAt: number; // ms epoch
  }
  
  export interface CooldownsState {
    abilities?: Record<string, AbilityCooldownState>;
    spells?: Record<string, AbilityCooldownState>;
    // later: items, songs, etc.
  }
  
  // Generic skill buckets (weapon, spell schools, gathering, etc.)
  export interface SkillBucket {
    [key: string]: number; // e.g. "one_handed": 15
  }
  
  export interface SkillsState {
    weapons?: SkillBucket;
    spells?: SkillBucket;
    gathering?: SkillBucket;
    // later: social, languages, etc.
  }
  
  // Titles & cosmetic progression
  export interface TitlesState {
    active?: string;
    unlocked?: string[];
  }
  
  // Gathering disciplines per character
  export interface GatheringDisciplineState {
    nodesGathered?: number;
    // later: tier, lastNodeAt, etc.
  }
  
  export interface GatheringState {
    [discipline: string]: GatheringDisciplineState; // "mining", "herbalism", etc.
  }
  
  // Generic counters (kills, harvests, etc.) and flags
  export interface CountersState {
    [key: string]: number;
  }
  
  export interface FlagsState {
    [key: string]: boolean | number | string;
  }
  
  // This is the canonical shape of character.progression JSON.
  //
  export interface CharacterProgression {
    powerResources?: Record<string, PowerResourceState>;
    cooldowns?: CooldownsState;
    skills?: SkillsState;
    titles?: TitlesState;
  
    // Generic key-value stats
    counters?: CountersState;
    flags?: FlagsState;
  
    // System-specific compact state
    gathering?: GatheringState;
  
    // Reserved for future tables we may later normalize:
    quests?: any;
    tasks?: any;
    // etc. – but we try to keep these compact.
  }
  