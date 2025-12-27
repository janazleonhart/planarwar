//worldcore/items/OverflowPolicy.ts

export type OverflowPolicy =
  | "drop"      // drop at player position (future)
  | "destroy"   // delete remainder (safe default for dev)
  | "mail";     // mail overflow (future)
