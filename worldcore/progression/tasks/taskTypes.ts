// worldcore/progression/tasks/taskTypes.ts

export interface SimpleTask {
  id: string;
  type: "kill" | "harvest";
  target: string;
  required: number;
  completed?: boolean;
  reward?: {
    xp?: number;
    // later: currency, items, etc.
  };
}
