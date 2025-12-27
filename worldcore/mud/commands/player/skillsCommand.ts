// worldcore/mud/commands/player/skillsCommand.ts

import { getWeaponSkill, getSpellSchoolSkill, } from "../../../skills/SkillProgression";
import { getPrimaryPowerResourceForClass, } from "../../../resources/PowerResources";

import type { WeaponSkillId, SpellSchoolId } from "../../../combat/CombatEngine";

const WEAPON_SKILLS: WeaponSkillId[] = [
  "unarmed",
  "one_handed",
  "two_handed",
  "ranged",
];

const SPELL_SCHOOLS: SpellSchoolId[] = [
  "arcane",
  "fire",
  "frost",
  "shadow",
  "holy",
  "nature",
];

export async function handleSkillsCommand(
    ctx: any,
    char: any,
    _input: { cmd: string; args: string[]; parts: string[] }
  ): Promise<string> {
    const lines: string[] = [];
  
    const classId = (char.classId ?? "").toLowerCase();
    const primaryRes = getPrimaryPowerResourceForClass(char.classId);
  
    const isFuryClass = primaryRes === "fury";
    const isManaClass = primaryRes === "mana";
    const isAdventurer = classId === "adventurer";
  
    // Simple rule for now:
    // - Fury classes: weapons only
    // - Mana classes: weapons + spells
    // - Adventurer: same as mana for now (can get fancy later)
    const showWeapons = true;
    const showSpells = isManaClass || isAdventurer;
  
    lines.push("Skills:");
    lines.push("");
  
    // --- Weapon skills ---
    if (showWeapons) {
      const weaponLines: string[] = [];
  
      for (const skill of WEAPON_SKILLS) {
        const value = getWeaponSkill(char, skill);
        weaponLines.push(`- ${labelWeaponSkill(skill)}: ${value}`);
      }
  
      if (weaponLines.length > 0) {
        lines.push("Weapon Skills:");
        lines.push(...weaponLines);
        lines.push("");
      }
    }
  
    // --- Spell schools ---
    if (showSpells) {
      const spellLines: string[] = [];
  
      for (const school of SPELL_SCHOOLS) {
        const value = getSpellSchoolSkill(char, school);
        spellLines.push(`- ${labelSpellSchool(school)}: ${value}`);
      }
  
      if (spellLines.length > 0) {
        lines.push("Spell Schools:");
        lines.push(...spellLines);
      }
    }
  
    return lines.join("\n");
  }
  
  function labelWeaponSkill(skill: WeaponSkillId): string {
    switch (skill) {
      case "unarmed":
        return "Unarmed";
      case "one_handed":
        return "One-handed";
      case "two_handed":
        return "Two-handed";
      case "ranged":
        return "Ranged";
      default:
        return skill;
    }
  }
  
  function labelSpellSchool(school: SpellSchoolId): string {
    switch (school) {
      case "arcane":
        return "Arcane";
      case "fire":
        return "Fire";
      case "frost":
        return "Frost";
      case "shadow":
        return "Shadow";
      case "holy":
        return "Holy";
      case "nature":
        return "Nature";
      default:
        return school;
    }
  }
