#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Planar War: Service token helper
 *
 * Generates either:
 *  - a random signing secret (hex) for PW_SERVICE_TOKEN_SECRET
 *  - a derived service token: svc:<serviceId>:<role>:<hmacHex>
 *
 * Usage:
 *  npm run -w mother-brain gen:service-secret
 *  npm run -w mother-brain gen:service-token -- --serviceId mother-brain --role readonly
 *
 * Env:
 *  PW_SERVICE_TOKEN_SECRET (preferred), PW_SERVICE_TOKEN_SECRET_PREV (rotation), or PW_AUTH_JWT_SECRET (fallback)
 */

const crypto = require('node:crypto');

function parseArgs(argv) {
  const args = {
    genSecret: false,
    bytes: 32,
    serviceId: 'mother-brain',
    role: 'readonly',
    secret: undefined,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--gen-secret') {
      args.genSecret = true;
      continue;
    }
    if (a === '--bytes') {
      const v = argv[i + 1];
      i++;
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0 || n > 4096) {
        throw new Error(`Invalid --bytes '${v}'. Expected a positive number <= 4096.`);
      }
      args.bytes = Math.floor(n);
      continue;
    }
    if (a === '--serviceId') {
      const v = argv[i + 1];
      i++;
      if (!v) throw new Error('Missing value for --serviceId');
      args.serviceId = v;
      continue;
    }
    if (a === '--role') {
      const v = argv[i + 1];
      i++;
      if (!v) throw new Error('Missing value for --role');
      args.role = v;
      continue;
    }
    if (a === '--secret') {
      const v = argv[i + 1];
      i++;
      if (!v) throw new Error('Missing value for --secret');
      args.secret = v;
      continue;
    }
    if (a === '--help' || a === '-h') {
      args.help = true;
      continue;
    }
    throw new Error(`Unknown argument '${a}'. Use --help.`);
  }

  return args;
}

function printHelp() {
  console.log(`\
Planar War: genServiceToken

Generate a signing secret (hex) or a derived service token.

Examples:
  # Generate a strong random secret (set this on the web-backend server)
  npm run -w mother-brain gen:service-secret

  # Generate a token (requires PW_SERVICE_TOKEN_SECRET in env)
  PW_SERVICE_TOKEN_SECRET=... npm run -w mother-brain gen:service-token -- --serviceId mother-brain --role readonly

Options:
  --gen-secret           Print a random hex secret (for PW_SERVICE_TOKEN_SECRET)
  --bytes <n>            Bytes for secret (default 32 => 256-bit)
  --serviceId <id>       Service id (default mother-brain)
  --role <role>          Role (readonly|editor|root) (default readonly)
  --secret <hex>          Use an explicit secret value (avoids env loading)
  --help                 Show this help

Env:
  PW_SERVICE_TOKEN_SECRET (preferred), PW_SERVICE_TOKEN_SECRET_PREV (rotation), or PW_AUTH_JWT_SECRET (fallback)
`);
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(String(err && err.message ? err.message : err));
    process.exit(2);
    return;
  }

  if (args.help) {
    printHelp();
    return;
  }

  if (args.genSecret) {
    const secret = crypto.randomBytes(args.bytes).toString('hex');
    console.log(secret);
    return;
  }

  const secret =
    args.secret ||
    process.env.PW_SERVICE_TOKEN_SECRET ||
    process.env.PW_SERVICE_TOKEN_SECRET_PREV ||
    process.env.PW_AUTH_JWT_SECRET;
  if (secret == null || secret === '') {
    console.error('Missing PW_SERVICE_TOKEN_SECRET (preferred), PW_SERVICE_TOKEN_SECRET_PREV (rotation), or PW_AUTH_JWT_SECRET');
    process.exit(1);
    return;
  }

  const msg = `${args.serviceId}:${args.role}`;
  const sig = crypto.createHmac('sha256', secret).update(msg).digest('hex');
  console.log(`svc:${args.serviceId}:${args.role}:${sig}`);
}

main();
