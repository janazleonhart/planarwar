//worldcore/test/contract_debugGate_serviceDaemonAllowlist.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { requireDebug } from "../auth/debugGate";

test("[contract] service daemon may use allowlisted debug command", () => {
  const prevMode = process.env.PW_SHARD_MODE;
  try {
    process.env.PW_SHARD_MODE = "dev";
    const ctx = {
      session: {
        identity: {
          userId: "user_test",
          displayName: "svc:mother_brain_daemon",
          flags: {},
          authKind: "service",
          serviceId: "mother_brain_daemon",
          serviceRole: "editor",
          serviceCommandAllowlist: ["debug_xp"],
        },
      },
    };
    assert.equal(requireDebug(ctx, "dev", "debug_xp"), null);
    assert.match(String(requireDebug(ctx, "dev", "debug_give")), /not allowed/i);
  } finally {
    if (prevMode === undefined) delete process.env.PW_SHARD_MODE;
    else process.env.PW_SHARD_MODE = prevMode;
  }
});
