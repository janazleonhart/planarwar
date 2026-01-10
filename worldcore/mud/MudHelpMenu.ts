// worldcore/mud/MudHelpMenu.ts

export const HELP_ENTRIES: { cmd: string; desc: string; debug?: boolean }[] = [
  // Meta
  { cmd: "help / ?", desc: "Show this help." },

  // Social
  { cmd: "say <msg>", desc: "Talk in local chat." },
  { cmd: "tell <name> <msg>", desc: "Send a private message." },
  { cmd: "gchat <msg>", desc: "Talk in guild chat (if in a guild)." },

  // Who / info
  { cmd: "who", desc: "List players in your current room." },
  { cmd: "whoall", desc: "List all online players." },
  { cmd: "whois <name>", desc: "Inspect another player." },

  // World
  { cmd: "look", desc: "Describe your current region." },
  { cmd: "examine <thing>", desc: "Examine an NPC/resource in your area." },
  { cmd: "nearby", desc: "List nearby entities." },
  { cmd: "map [radius]", desc: "Show an ASCII map around you." },
  { cmd: "move <dir>", desc: "Move (n,s,e,w,ne,nw,se,sw)." },
  { cmd: "walk / go <dir>", desc: "Move (synonyms)." },
  { cmd: "save", desc: "Force-save your character." },

  // Character
  { cmd: "stats / sheet", desc: "Show your character sheet and attributes." },
  { cmd: "risk / cowardice", desc: "Show cowardice stacks and region danger for your current region." },
  { cmd: "effects / buffs", desc: "Show your active temporary effects (buffs and debuffs)." },
  { cmd: "inv / inventory", desc: "Show your inventory and bags." },
  { cmd: "iteminfo <idOrName>", desc: "Inspect an item (DB or static)." },
  { cmd: "equip <slot>", desc: "Equip the first matching item from bags into a slot." },
  { cmd: "unequip <slot>", desc: "Move an equipped item back to bags." },

  // Combat
  { cmd: "attack <target>", desc: "Attack a target (NPCs/training dummy)." },
  { cmd: "autoattack [on|off]", desc: "Toggle autoattacking the training dummy." },
  { cmd: "abilities", desc: "List your known abilities." },
  { cmd: "ability <name> [target]", desc: "Use an ability." },
  { cmd: "spells", desc: "List your known spells." },
  { cmd: "cast <spell> [target]", desc: "Cast a spell." },
  { cmd: "respawn", desc: "If dead, return to life in place." },
  { cmd: "rest / sleep", desc: "Restore health (and resurrect if dead)." },

  // Economy
  { cmd: "trade", desc: "Trade actions (see: trade help / show)." },
  { cmd: "vendor", desc: "Vendor actions (see: vendor help / list)." },
  { cmd: "auction / ah", desc: "Auction house actions (see: ah help / browse)." },
  { cmd: "bank", desc: "Bank actions (show/deposit/withdraw)." },
  { cmd: "mail", desc: "Mail (list/read/claim)." },

  // Crafting / Gathering
  { cmd: "craft", desc: "List or craft recipes (craft list | craft <id> [count])." },
  { cmd: "harvest <what>", desc: "Harvest nearby resources (e.g. ore)." },

  // Progression
  { cmd: "titles", desc: "List unlocked titles and active title." },
  { cmd: "title", desc: "Show your current title." },
  { cmd: "settitle <id>", desc: "Set your active title by id." },
  { cmd: "progress", desc: "Show kills/harvests/tasks progress." },
  { cmd: "quests / questlog", desc: "Show your quest log." },
  { cmd: "quest turnin <id|name>", desc: "Turn in a completed quest." },

  // Debug (keep these grouped; players will sniff them out anyway)
  { cmd: "debug_give <itemId>", desc: "Dev: grant yourself a static item.", debug: true },
  { cmd: "debug_give_mat <idOrName>", desc: "Dev: grant yourself a DB-backed item.", debug: true },
  { cmd: "debug_xp <amount>", desc: "Dev: grant XP to test leveling.", debug: true },
];
