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
import { handleWhoCommand, handleWhoAllCommand, handleWhoIsCommand } from "./social/whoCommand";
import { handleNearbyCommand } from "./world/nearbyCommand";
import { handleMapCommand } from "./world/mapCommand";
import { handleSaveCommand } from "./world/saveCommand";
import { handleMoveCommand } from "./world/moveCommand";
import { handleSayCommand, handleTellCommand } from "./social/chatCommand";
import { handleGuildChatCommand } from "./social/guildChatCommand";
import { handleInteractCommand } from "./world/interactCommand";
import { handleInventoryCommand } from "./player/inventoryCommand";
import { handleItemInfoCommand } from "./player/itemInfoCommand";
import { handleEquipCommand, handleUnequipCommand } from "./player/equipmentCommand";
import { handleStatsCommand } from "./player/statsCommand";
import { handleCastMudCommand } from "./combat/castCommand";
import { handleAbilityMudCommand } from "./combat/abilityCommand";
import { handleAbilitiesListCommand } from "./combat/abilitiesListCommand";
import { handleSpellsListCommand } from "./combat/spellsListCommand";
import { handlePickingCommand } from "./gathering/pickingCommand";
import { handleMiningCommand } from "./gathering/miningCommand";
import { handleQuestsCommand, handleQuestCommand } from "./progression/questsCommand";
import { handleProgressCommand } from "./progression/progressCommand";
import { handleAttackCommand } from "./combat/attackCommand";
import { handleAutoAttackCommand } from "./combat/autoAttackCommand";
import { handleTitleCommand, handleTitlesCommand, handleSetTitleCommand } from "./progression/titlesCommand";
import { handleRespawnCommand,handleRestCommand } from "./player/recoveryCommand";
import { handleHelpCommand } from "./meta/helpCommand";
import { withDebugGate } from "./debug/withDebugGate";
import { handleDebugGive, handleDebugXp, handleDebugSpawnNpc, handleEventGiveAny, handleEventMailReward,
         handleDebugGiveMat, handleDebugResetLevel, handleDebugHurt, handleDebugSpawnRat, handleDebugSpawnOre,
         handleDebugSpawnsHere, handleDebugTake, handleDebugMailTest,} from "./debug/handlers";
import { handleGuildBankCommand } from "./guildBankCommand";
import { handleTalkCommand } from "./world/talkCommand";
import { handleResourcesCommand } from "./player/resourcesCommand";
import { handleSkillsCommand } from "./player/skillsCommand";

import type { MudCommandHandlerFn } from "./types"

export const COMMANDS: Record<string, MudCommandHandlerFn> = {
  bank: async (ctx, char, input) => handleBankCommand(ctx, char, input.args),
  gbank: async (ctx, char, input) => handleGuildBankCommand(ctx, char, input.args),
  guildbank: async (ctx, char, input) => handleGuildBankCommand(ctx, char, input.args),

  trade: async (ctx, char, input) => handleTradeCommand(ctx, char, input.args),

  vendor: async (ctx, char, input) => handleVendorCommand(ctx, char, input.args),
  buy: async (ctx, char, input) => handleVendorCommand(ctx, char, ["buy", ...input.args]),
  sell: async (ctx, char, input) => handleVendorCommand(ctx, char, ["sell", ...input.args]),

  auction: async (ctx, char, input) => handleAuctionCommand(ctx, char, input.parts),
  ah: async (ctx, char, input) => handleAuctionCommand(ctx, char, input.parts),

  mail: async (ctx, _char, input) => handleMailCommand(ctx, input.args),

  craft: async (ctx, char, input) => handleCraftCommand(ctx, char, input.parts),

  look: async (ctx, char, input) => handleLookCommand(ctx, char, input, ctx.world ?? undefined),

  examine: handleExamineCommand,

  inspect_region: handleInspectRegionCommand,

  who: handleWhoCommand,
  whoall: handleWhoAllCommand,
  whois: handleWhoIsCommand,
  nearby: handleNearbyCommand,

  map: handleMapCommand,

  save: handleSaveCommand,

  move: handleMoveCommand,
  walk: handleMoveCommand,
  go: handleMoveCommand,
  
  say: handleSayCommand,
  tell: handleTellCommand,
  whisper: handleTellCommand,
  gchat: handleGuildChatCommand,
  talk: handleTalkCommand,

  interact: handleInteractCommand,
  use: handleInteractCommand,

  inv: async (ctx, char) => handleInventoryCommand(ctx, char),
  inventory: async (ctx, char) => handleInventoryCommand(ctx, char),

  item: handleItemInfoCommand,
  iteminfo: handleItemInfoCommand,

  equip: handleEquipCommand,
  unequip: handleUnequipCommand,

  resources: handleResourcesCommand,
  res: handleResourcesCommand,

  skills: async (ctx, char, input) => handleSkillsCommand(ctx, char, input),
  skill: async (ctx, char, input) => handleSkillsCommand(ctx, char, input),

  stats: handleStatsCommand,
  sheet: handleStatsCommand,

  cast: handleCastMudCommand,
  ability: handleAbilityMudCommand,
  use_ability: handleAbilityMudCommand,
  abilities: async (ctx, char, input) => handleAbilitiesListCommand(ctx, char),
  spells: async (ctx, char) => handleSpellsListCommand(ctx, char),


  pick: handlePickingCommand,
  mine: handleMiningCommand,
  
  quests: async (ctx, char) => handleQuestsCommand(ctx, char),
  questlog: async (ctx, char) => handleQuestsCommand(ctx, char),
  quest: handleQuestCommand,
  progress: async (ctx, char) => handleProgressCommand(ctx, char),

  attack: handleAttackCommand,
  autoattack: handleAutoAttackCommand,

  title: async (ctx, char) => handleTitleCommand(ctx, char),
  titles: async (ctx, char) => handleTitlesCommand(ctx, char),
  settitle: handleSetTitleCommand,

  respawn: async (ctx) => handleRespawnCommand(ctx),
  rest: async (ctx) => handleRestCommand(ctx),
  sleep: async (ctx) => handleRestCommand(ctx),

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



  event_give_any: withDebugGate(handleEventGiveAny, "owner"),
  event_mail_reward: withDebugGate(handleEventMailReward, "gm"),

};
