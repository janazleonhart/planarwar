//worldcore/mud/commands/types.ts

import type { CharacterState } from "../../characters/CharacterTypes";
import type { MudContext } from "../MudContext";
import type { ServerWorldManager } from "../../world/ServerWorldManager";

export type MudServices = {
  trainingDummy?: {
    getTrainingDummyForRoom: (roomId: string) => any;
    computeTrainingDummyDamage: (effective: any) => number;
    startTrainingDummyAi: (ctx: MudContext, sessionId: string, roomId: string) => void;
  };
};

export type MudCommandInput = {
  cmd: string;
  args: string[];
  parts: string[];
  world?: ServerWorldManager;
  services?: MudServices;
};

export type MudCommandHandlerFn = (
  ctx: MudContext,
  char: CharacterState,
  input: MudCommandInput
) => Promise<string | null>;
