import { randomUUID } from "crypto";

export function uuidv4(): string {
  try {
    if (typeof randomUUID === "function") {
      return randomUUID();
    }
  } catch {
    // fall through to fallback value
  }
  return "00000000-0000-4000-8000-000000000000";
}
