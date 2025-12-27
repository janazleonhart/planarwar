// worldcore/mud/commands/player/skillsCommand.ts

import type { MudContext } from "../../MudContext";
import {
  getWeaponSkill,
  getSpellSchoolSkill,
  getSongSchoolSkill,
} from "../../../skills/SkillProgression";

export async function handleSkillsCommand(
  ctx: MudContext
): Promise<string> {
  const char = ctx.session.character;

  if (!char) {
    return "You do not have an active character.";
  }

  const classId = (char.classId ?? "").toLowerCase();

  // v0 rule: Virtuoso is a pure song/instrument class, so we hide spell schools
  const isSongOnlyClass = classId === "virtuoso";

  // --- Weapon skills ---

  const weaponLines: string[] = [
    `- Unarmed: ${getWeaponSkill(char, "unarmed")}`,
    `- One-handed: ${getWeaponSkill(char, "one_handed")}`,
    `- Two-handed: ${getWeaponSkill(char, "two_handed")}`,
    `- Ranged: ${getWeaponSkill(char, "ranged")}`,
  ];

  // --- Spell schools (elemental/holy/etc.) ---

  const spellLines: string[] = [
    `- Arcane: ${getSpellSchoolSkill(char, "arcane")}`,
    `- Fire: ${getSpellSchoolSkill(char, "fire")}`,
    `- Frost: ${getSpellSchoolSkill(char, "frost")}`,
    `- Shadow: ${getSpellSchoolSkill(char, "shadow")}`,
    `- Holy: ${getSpellSchoolSkill(char, "holy")}`,
    `- Nature: ${getSpellSchoolSkill(char, "nature")}`,
  ];

  // --- Song / instrument schools ---

  const songLines: string[] = [
    `- Voice: ${getSongSchoolSkill(char, "voice")}`,
    `- Strings: ${getSongSchoolSkill(char, "strings")}`,
    `- Winds: ${getSongSchoolSkill(char, "winds")}`,
    `- Percussion: ${getSongSchoolSkill(char, "percussion")}`,
    `- Brass: ${getSongSchoolSkill(char, "brass")}`,
  ];

  let out = "Skills:\n";

  out += "Weapon Skills:\n";
  out += weaponLines.map((l) => ` ${l}`).join("\n");

  if (!isSongOnlyClass) {
    out += "\nSpell Schools:\n";
    out += spellLines.map((l) => ` ${l}`).join("\n");
  }

  out += "\nSong Schools:\n";
  out += songLines.map((l) => ` ${l}`).join("\n");

  return out;
}
