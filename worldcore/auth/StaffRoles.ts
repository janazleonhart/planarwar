// worldcore/auth/StaffRoles.ts

export type StaffRole =
  | "player"
  | "guide"
  | "gm"
  | "dev"
  | "owner"; // event host / shard owner, can bypass almost everything

export const StaffRoleLevel: Record<StaffRole, number> = {
  player: 0,
  guide: 10,
  gm: 20,
  dev: 30,
  owner: 40,
};
