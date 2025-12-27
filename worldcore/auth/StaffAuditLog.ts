// worldcore/auth/StaffAuditLog.ts

import { db } from "../db/Database";
import { Logger } from "../utils/logger";
import { AttachedIdentity } from "../shared/AuthTypes";

const log = Logger.scope("STAFF_AUDIT");

export async function logStaffAction(
  identity: AttachedIdentity | undefined,
  actionName: string,
  details: Record<string, any>
): Promise<void> {
  const actorId = identity?.userId ?? null;
  const actorName = identity?.displayName ?? "unknown";

  try {
    await db.query(
      `
      INSERT INTO staff_action_log (actor_id, actor_name, action_name, details)
      VALUES ($1, $2, $3, $4::jsonb)
      `,
      [actorId, actorName, actionName, JSON.stringify(details)]
    );
  } catch (err) {
    // Never let logging kill a staff command.
    log.warn("Failed to write staff_action_log row", {
      err: String(err),
      actorId,
      actorName,
      actionName,
    });
  }
}
