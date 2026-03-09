//web-backend/bootstrape/env.ts

import dotenv from "dotenv";
import fs from "fs";
import path from "path";

function tryLoadDotEnv(): void {
  const candidates = new Set<string>();

  let cur = process.cwd();
  for (let i = 0; i < 6; i++) {
    candidates.add(path.join(cur, ".env"));
    candidates.add(path.join(cur, ".env.local"));
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }

  cur = __dirname;
  for (let i = 0; i < 6; i++) {
    candidates.add(path.join(cur, ".env"));
    candidates.add(path.join(cur, ".env.local"));
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        dotenv.config({ path: p });
        // eslint-disable-next-line no-console
        console.log(`[web-backend] loaded env: ${p}`);
        return;
      }
    } catch {
      // ignore
    }
  }

  dotenv.config();
}

function bridgePlanarWarDbEnv(): void {
  const hasUrl =
    !!process.env.PW_DATABASE_URL ||
    !!process.env.DATABASE_URL ||
    !!process.env.POSTGRES_URL ||
    !!process.env.PG_URL;

  if (hasUrl) return;

  const host = process.env.PW_DB_HOST;
  const port = process.env.PW_DB_PORT;
  const user = process.env.PW_DB_USER;
  const pass = process.env.PW_DB_PASS;
  const name = process.env.PW_DB_NAME;

  if (!host || !user || !name) return;

  if (!process.env.PGHOST) process.env.PGHOST = host;
  if (!process.env.PGPORT && port) process.env.PGPORT = port;
  if (!process.env.PGUSER) process.env.PGUSER = user;
  if (!process.env.PGDATABASE) process.env.PGDATABASE = name;
  if (!process.env.PGPASSWORD && pass) process.env.PGPASSWORD = pass;

  const encUser = encodeURIComponent(user);
  const encPass = pass ? encodeURIComponent(pass) : "";
  const safePort = port ? String(port) : "5432";

  const auth = encPass ? `${encUser}:${encPass}` : encUser;
  const url = `postgresql://${auth}@${host}:${safePort}/${name}`;

  if (!process.env.PW_DATABASE_URL) process.env.PW_DATABASE_URL = url;
  if (!process.env.DATABASE_URL) process.env.DATABASE_URL = url;
}

export function bootstrapWebBackendEnv(): void {
  tryLoadDotEnv();
  bridgePlanarWarDbEnv();
}
