// worldcore/mud/commands/registry.ts

import { handleBankCommand } from "./bankCommand";
import { handleTradeCommand } from "./economy/tradeCommand";
import { handleVendorCommand } from "./economy/vendorCommand";
import { handleAuctionCommand } from "./economy/auctionCommand";
import { handleMailCommand } from "./social/mailCommand";
import { handleCraftCommand } from "./craftCommand";

import { handleLookCommand } from "./world/lookCommand";
import { handleExamineCommand } from "./world/examineCommand";
import { handleInspectRegionCommand } from "./world/inspectRegionCommand";
import { handleNearbyCommand } from "./world/nearbyCommand";
import { handleMapCommand } from "./world/mapCommand";
import { handleSaveCommand } from "./world/saveCommand";
import { handleMoveCommand } from "./world/moveCommand";
import { handleInteractCommand } from "./world/interactCommand";
import { handleTalkCommand } from "./world/talkCommand";
import { requireTownService } from "./world/serviceGates";
import { handleWalkToCommand } from "./world/walktoCommand";

import {
  handleWhoCommand,
  handleWhoAllCommand,
  handleWhoIsCommand,
} from "./social/whoCommand";
import { handleSayCommand, handleTellCommand } from "./social/chatCommand";
import { handleGuildChatCommand } from "./social/guildChatCommand";

import { handleHelpCommand } from "./meta/helpCommand";

import { handleInventoryCommand } from "./player/inventoryCommand";
import { handleItemInfoCommand } from "./player/itemInfoCommand";
import {
  handleEquipCommand,
  handleUnequipCommand,
} from "./player/equipmentCommand";
import { handleStatsCommand } from "./player/statsCommand";
import {
  handleRespawnCommand,
  handleRestCommand,
} from "./player/recoveryCommand";
import { handleResourcesCommand } from "./player/resourcesCommand";
import { handleSkillsCommand } from "./player/skillsCommand";
import { handleGuildBankCommand } from "./guildBankCommand";

// Virtuoso
import { handleMelodyCommand } from "./player/melodyCommand";
import { handleSongsCommand } from "./player/songsCommand";

// Spells / combat
import { handleCastMudCommand } from "./combat/castCommand";
import { handleAbilityMudCommand } from "./combat/abilityCommand";
import { handleAbilitiesCommand } from "./player/abilitiesCommand";
import { handleSpellsCommand } from "./player/spellsCommand";
import { handleAttackCommand } from "./combat/attackCommand";
import { handleAutoAttackCommand } from "./combat/autoAttackCommand";

// Gathering
import { handlePickingCommand } from "./gathering/pickingCommand";
import { handleMiningCommand } from "./gathering/miningCommand";
import { handleFishingCommand } from "./gathering/fishingCommand";
import { handleFarmingCommand } from "./gathering/farmingCommand";
import { handleLumberingCommand } from "./gathering/lumberingCommand";
import { handleQuarryingCommand } from "./gathering/quarryingCommand";
import { handleSkinningCommand } from "./gathering/skinningCommand";

// Progression
import {
  handleQuestsCommand,
  handleQuestCommand,
} from "./progression/questsCommand";
import { handleProgressCommand } from "./progression/progressCommand";
import {
  handleTitleCommand,
  handleTitlesCommand,
  handleSetTitleCommand,
} from "./progression/titlesCommand";
import { handleRewardCommand } from "./progression/rewardCommand";

// Player status / effects
import { handleEffectsCommand } from "./player/effectsCommand";
import { handleRiskCommand } from "./player/riskCommand";

// Debug / meta
import { withDebugGate } from "./debug/withDebugGate";
import {
  handleDebugGive,
  handleDebugXp,
  handleDebugSpawnNpc,
  handleEventGiveAny,
  handleEventMailReward,
  handleDebugGiveMat,
  handleDebugResetLevel,
  handleDebugHurt,
  handleDebugSpawnRat,
  handleDebugSpawnOre,
  handleDebugSpawnsHere,
  handleDebugTake,
  handleDebugMailTest,
  handleDebugNpcAi,
  handleDebugHydrateHere,
  handleDebugRegionFlags,
} from "./debug/handlers";
import {
  handleDebugRegionDanger,
  handleDebugBumpRegionDanger,
} from "./debug/regionDangerCommands";
import { handleDebugVulnerability } from "./debug/vulnerabilityCommands";
import { handleDebugRegionEvent, handleDebugRegionPvp } from "./debug/regionEventCommands";
import { handleReloadCommand } from "./debug/reloadCommand";

import type { MudCommandHandlerFn } from "./types";

export const COMMANDS: Record<string, MudCommandHandlerFn> = {
  // Economy / Services
  bank: async (ctx, char, input) =>
    requireTownService(ctx, char, "bank", () =>
      handleBankCommand(ctx, char, input.args),
    ) as any,
  gbank: async (ctx, char, input) =>
    requireTownService(ctx, char, "guildbank", () =>
      handleGuildBankCommand(ctx, char, input.args),
    ) as any,
  guildbank: async (ctx, char, input) =>
    requireTownService(ctx, char, "guildbank", () =>
      handleGuildBankCommand(ctx, char, input.args),
    ) as any,
  trade: async (ctx, char, input) =>
    handleTradeCommand(ctx, char, input.args),
  vendor: async (ctx, char, input) =>
    requireTownService(ctx, char, "vendor", () =>
      handleVendorCommand(ctx, char, input.args),
    ) as any,
  buy: async (ctx, char, input) =>
    requireTownService(ctx, char, "vendor", () =>
      handleVendorCommand(ctx, char, ["buy", ...input.args]),
    ) as any,
  sell: async (ctx, char, input) =>
    requireTownService(ctx, char, "vendor", () =>
      handleVendorCommand(ctx, char, ["sell", ...input.args]),
    ) as any,
  auction: async (ctx, char, input) =>
    requireTownService(ctx, char, "auction", () =>
      handleAuctionCommand(ctx, char, input.parts),
    ) as any,
  ah: async (ctx, char, input) =>
    requireTownService(ctx, char, "auction", () =>
      handleAuctionCommand(ctx, char, input.parts),
    ) as any,
  mail: async (ctx, char, input) =>
    requireTownService(ctx, char, "mail", () =>
      Promise.resolve(handleMailCommand(ctx, input.args) as any),
    ) as any,

  // Crafting
  craft: async (ctx, char, input) =>
    handleCraftCommand(ctx, char, input.parts),

  // World
  look: async (ctx, char, input) =>
    handleLookCommand(ctx, char, input, (ctx as any).world ?? undefined),
  examine: handleExamineCommand,
  inspect_region: handleInspectRegionCommand,
  nearby: handleNearbyCommand,
  map: handleMapCommand,
  save: handleSaveCommand,
  move: handleMoveCommand,
  walk: handleMoveCommand,
  go: handleMoveCommand,
  talk: handleTalkCommand,
  interact: handleInteractCommand,
  use: handleInteractCommand,
  walkto: handleWalkToCommand,
  wt: handleWalkToCommand,

  // Social
  who: handleWhoCommand,
  whoall: handleWhoAllCommand,
  whois: handleWhoIsCommand,
  say: handleSayCommand,
  tell: handleTellCommand,
  whisper: handleTellCommand,
  gchat: handleGuildChatCommand,

  // Player
  inv: async (ctx, char) => handleInventoryCommand(ctx, char),
  inventory: async (ctx, char) => handleInventoryCommand(ctx, char),
  item: handleItemInfoCommand,
  iteminfo: handleItemInfoCommand,
  equip: handleEquipCommand,
  unequip: handleUnequipCommand,
  resources: handleResourcesCommand,
  res: handleResourcesCommand,
  skills: async (ctx) => handleSkillsCommand(ctx),
  skill: async (ctx) => handleSkillsCommand(ctx),
  melody: async (ctx, char, input) =>
    handleMelodyCommand(ctx, char, input),
  song: handleSongsCommand,
  songs: handleSongsCommand,
  stats: handleStatsCommand,
  sheet: handleStatsCommand,
  status: handleStatsCommand, // QoL alias for stats

  risk: async (ctx, char, input) =>
    handleRiskCommand(ctx, char, input),
  cowardice: async (ctx, char, input) =>
    handleRiskCommand(ctx, char, input),

  effects: handleEffectsCommand,
  buffs: handleEffectsCommand,

  // Combat
  cast: handleCastMudCommand,
  ability: handleAbilityMudCommand,
  use_ability: handleAbilityMudCommand,
  abilities: async (ctx, char) => handleAbilitiesCommand(ctx, char),
  spell: async (ctx, char) => handleSpellsCommand(ctx),
  spells: async (ctx, char) => handleSpellsCommand(ctx),
  attack: handleAttackCommand,
  autoattack: handleAutoAttackCommand,

  // Gathering
  pick: handlePickingCommand,
  mine: handleMiningCommand,  
  farm: handleFarmingCommand,  
  fish: handleFishingCommand,
  lumber: handleLumberingCommand,
  quarry: handleQuarryingCommand,
  skin: handleSkinningCommand,

  // Progression
  quests: async (ctx, char) => handleQuestsCommand(ctx, char),
  questlog: async (ctx, char) => handleQuestsCommand(ctx, char),
  quest: handleQuestCommand,
  progress: async (ctx, char) => handleProgressCommand(ctx, char),
  title: async (ctx, char) => handleTitleCommand(ctx, char),
  titles: async (ctx, char) => handleTitlesCommand(ctx, char),
  settitle: handleSetTitleCommand,

  reward: async (ctx, char, input) =>
    handleRewardCommand(ctx as any, char as any, input.args),
  rewards: async (ctx, char, input) =>
    handleRewardCommand(ctx as any, char as any, input.args),

  // Recovery
  respawn: async (ctx) => handleRespawnCommand(ctx),
  rest: async (ctx) => handleRestCommand(ctx),
  sleep: async (ctx) => handleRestCommand(ctx),

  // Meta
  help: async (ctx) => handleHelpCommand(ctx),
  "?": async (ctx) => handleHelpCommand(ctx),

  // Debug (gated)
  debug_give: withDebugGate(handleDebugGive, "dev"),
  debug_xp: withDebugGate(handleDebugXp, "dev"),
  debug_spawn_npc: withDebugGate(handleDebugSpawnNpc, "gm"),
  debug_give_mat: withDebugGate(handleDebugGiveMat, "dev"),
  debug_reset_level: withDebugGate(handleDebugResetLevel, "dev"),
  debug_reset: withDebugGate(handleDebugResetLevel, "dev"),
  debug_hurt: withDebugGate(handleDebugHurt, "dev"),
  debug_spawn_rat: withDebugGate(handleDebugSpawnRat, "gm"),
  debug_spawn_ore: withDebugGate(handleDebugSpawnOre, "gm"),
  debug_spawns_here: withDebugGate(handleDebugSpawnsHere, "gm"),
  debug_take: withDebugGate(handleDebugTake, "dev"),
  debug_mail_test: withDebugGate(handleDebugMailTest, "dev"),
  debug_npc_ai: withDebugGate(handleDebugNpcAi, "gm"),
  debug_hydrate_here: withDebugGate(handleDebugHydrateHere, "gm"),
  debug_region_flags: withDebugGate(handleDebugRegionFlags, "dev"),
  debug_region_event: withDebugGate(handleDebugRegionEvent, "dev"),
  debug_region_pvp: withDebugGate(handleDebugRegionPvp, "dev"),

  debug_region_danger: withDebugGate(handleDebugRegionDanger, "dev"),
  debug_bump_region_danger: withDebugGate(
    handleDebugBumpRegionDanger,
    "dev",
  ),

  debug_vuln: withDebugGate(handleDebugVulnerability, "dev"),

  // Hot reload (dev-only)
  reload: withDebugGate(handleReloadCommand, "dev"),
  debug_reload: withDebugGate(handleReloadCommand, "dev"),

  event_give_any: withDebugGate(handleEventGiveAny, "owner"),
  event_mail_reward: withDebugGate(handleEventMailReward, "gm"),
};
