//web-backend//index.ts

import express from "express";
import cors from "cors";

import { startSpawnSnapshotsRetentionScheduler } from "./routes/adminSpawnPoints";
import { bootstrapWebBackendEnv } from "./bootstrap/env";
import { registerHealthRoutes } from "./server/healthRoutes";
import { mountRouteGroups } from "./server/routeGroups";
import { startServiceHeartbeat } from "./server/heartbeat";

bootstrapWebBackendEnv();

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;

app.use(
  cors({
    origin: "*",
  }),
);
app.use(express.json());

registerHealthRoutes(app);
mountRouteGroups(app);

app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);

  startSpawnSnapshotsRetentionScheduler();
  startServiceHeartbeat({ port: PORT });
});
