//worldcore/mud/commands/combat/autoAttackCommand.ts

import { startTrainingDummyAutoAttack, stopAutoAttack } from "./autoattack/trainingDummyAutoAttack";

import type { MudContext } from "../../MudContext";
import type { CharacterState } from "../../../characters/CharacterTypes";
import type { TrainingDummyDeps } from "./autoattack/trainingDummyAutoAttack";

export async function handleAutoAttackCommand(
  ctx: MudContext,
  char: CharacterState,
  input: { cmd: string; args: string[]; parts: string[]; services?: any }
): Promise<string> {
  const sub = (input.args[0] ?? "").toLowerCase();

  const deps: TrainingDummyDeps | undefined = input.services?.trainingDummy;
  if (!deps) {
    return "Autoattack is not available (training dummy services not wired).";
  }

  if (!sub || sub === "on") {
    return startTrainingDummyAutoAttack(ctx, char, deps);
  }

  if (sub === "off") {
    return stopAutoAttack(ctx);
  }

  return "Usage: autoattack [on|off]";
}