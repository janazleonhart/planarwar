//worldcore/utils/random.ts

import { Logger } from "./logger";

const log = Logger.scope("Random");

export function rollInt(min: number, max: number): number {
    if (max <= min) return min;
    return min + Math.floor(Math.random() * (max - min + 1));
}