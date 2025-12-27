// worldcore/characters/characterSheet.ts

import { isDeadEntity } from "../combat/entityCombat";
import { prettyRegionName } from "../world/regionText";
import { computeEffectiveAttributes } from "./Stats";

export type CharacterSheetArgs = {
  items?: any;
  selfEntity?: any | null;
  now?: number;
  getActiveTitleName?: () => string | null;
};

export function buildCharacterSheetLine(char: any, args: CharacterSheetArgs = {}): string {
  const base = char.attributes ?? {};
  const effective = computeEffectiveAttributes(char, args.items);

  const now = args.now ?? Date.now();
  const selfEntity = args.selfEntity ?? null;

  let hpFragment = " HP: unknown";
  let statusFragment = "";

  if (selfEntity) {
    const e: any = selfEntity;
    const hp = typeof e.hp === "number" ? e.hp : 0;
    const maxHp = typeof e.maxHp === "number" ? e.maxHp : 0;
    const inCombatUntil = typeof e.inCombatUntil === "number" ? e.inCombatUntil : 0;

    if (maxHp > 0) hpFragment = ` HP: ${hp}/${maxHp}`;

    let status = "Idle";
    if (isDeadEntity(e)) status = "Dead";
    else if (inCombatUntil > now) status = "In combat";
    else if (maxHp > 0 && hp < maxHp) status = "Resting";

    statusFragment = ` Status: ${status}`;
  }

  const titleName = args.getActiveTitleName?.() ?? null;
  const titleFragment = titleName ? ` Title: ${titleName}` : "";

  const str = Number(base.str ?? 0), agi = Number(base.agi ?? 0), intv = Number(base.int ?? 0);
  const sta = Number(base.sta ?? 0), wis = Number(base.wis ?? 0), cha = Number(base.cha ?? 0);

  const estr = Number(effective.str ?? str);
  const eagi = Number(effective.agi ?? agi);
  const esta = Number(effective.sta ?? sta);

  return (
    `Name: ${char.name}${titleFragment} ` +
    `Class: ${char.classId} ` +
    `Level: ${char.level} XP: ${char.xp}` +
    hpFragment +
    statusFragment +
    ` World: ${char.shardId} Region: ${prettyRegionName(char.lastRegionId)}` +
    ` Attributes: ` +
    `STR ${str} (+${estr - str} → ${estr}) ` +
    `AGI ${agi} (+${eagi - agi} → ${eagi}) ` +
    `INT ${intv} ` +
    `STA ${sta} (+${esta - sta} → ${esta}) ` +
    `WIS ${wis} ` +
    `CHA ${cha}`
  );
}
