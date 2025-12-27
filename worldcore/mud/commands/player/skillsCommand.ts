// worldcore/mud/commands/player/skillsCommand.ts

import type { MudContext } from "../../MudContext";
import {
  getWeaponSkill,
  getSpellSchoolSkill,
  getSongSchoolSkill,
} from "../../../skills/SkillProgression";

/**
 * Show the character's trained skills:
 *  - Weapon skills
 *  - Spell schools
 *  - Song (instrument/vocal) schools
 */
export async function handleSkillsCommand(
  ctx: MudContext
): Promise<string> {
  const char = ctx.session.character;

  if (!char) {
    return "You do not have an active character.";
  }

  // Weapon skills
  const weaponLines: string[] = [
    `- Unarmed: ${getWeaponSkill(char, "unarmed")}`,
    `- One-handed: ${getWeaponSkill(char, "one_handed")}`,
    `- Two-handed: ${getWeaponSkill(char, "two_handed")}`,
    `- Ranged: ${getWeaponSkill(char, "ranged")}`,
  ];

  // Spell schools (classic elemental/holy/etc.)
  const spellLines: string[] = [
    `- Arcane: ${getSpellSchoolSkill(char, "arcane")}`,
    `- Fire: ${getSpellSchoolSkill(char, "fire")}`,
    `- Frost: ${getSpellSchoolSkill(char, "frost")}`,
    `- Shadow: ${getSpellSchoolSkill(char, "shadow")}`,
    `- Holy: ${getSpellSchoolSkill(char, "holy")}`,
    `- Nature: ${getSpellSchoolSkill(char, "nature")}`,
  ];

  // Song schools (instrument / vocal lines)
  const songLines: string[] = [
    `- Voice: ${getSongSchoolSkill(char, "voice")}`,
    `- Strings: ${getSongSchoolSkill(char, "strings")}`,
    `- Winds: ${getSongSchoolSkill(char, "winds")}`,
    `- Percussion: ${getSongSchoolSkill(char, "Percussion")}`,
    `- Brass: ${getSongSchoolSkill(char, "Brass")}`,
  ];

  let out = "Skills:\n";

  out += "Weapon Skills:\n";
  out += weaponLines.map((l) => ` ${l}`).join("\n");

  out += "\nSpell Schools:\n";
  out += spellLines.map((l) => ` ${l}`).join("\n");

  out += "\nSong Schools:\n";
  out += songLines.map((l) => ` ${l}`).join("\n");

  return out;
}
