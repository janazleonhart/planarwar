// worldcore/progression/tasks/taskTypes.ts

export interface SimpleTask {
  id: string;
  type: "kill" | "harvest";
  target: string;
  required: number;
  completed?: boolean;

  reward?: {
    xp?: number;
    gold?: number;
    items?: { itemId: string; quantity: number }[];
  };
}
