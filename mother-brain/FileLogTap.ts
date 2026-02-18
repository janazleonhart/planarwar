// mother-brain/FileLogTap.ts
//
// Copy of mmo-backend/FileLogTap.ts so Mother Brain can write to the same
// log directory/pattern (via PW_FILELOG) without importing across workspaces.

import fs from "fs";
import util from "util";

type ConsoleMethod = (...args: unknown[]) => void;

// Matches ANSI color codes like \u001b[32m, \u001b[0m, etc.
const ANSI_REGEX = /\u001b\[[0-9;]*m/g;

function stripAnsi(input: string): string {
  return input.replace(ANSI_REGEX, "");
}

function serializeArg(arg: unknown): string {
  if (typeof arg === "string") {
    return stripAnsi(arg);
  }

  if (arg instanceof Error) {
    const msg = arg.stack ?? arg.message;
    return stripAnsi(msg);
  }

  try {
    return stripAnsi(JSON.stringify(arg));
  } catch {
    return stripAnsi(util.inspect(arg));
  }
}

function formatLine(args: unknown[]): string {
  return args.map(serializeArg).join(" ");
}

function createTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Extract logger scope from a formatted payload line.
 *
 * Logger prints tags like: "[NPC:INFO]" or "[WORLD:DEBUG]".
 * We scan for that pattern and return the SCOPE part.
 */
function extractScopeFromPayload(payload: string): string | null {
  const match = payload.match(/\[([A-Z0-9_]+):[A-Z]+\]/);
  if (!match) return null;
  return match[1] ?? null;
}

/**
 * Normalize a scope name into a safe filename fragment.
 */
function normalizeScopeForFilename(scope: string): string {
  return (
    scope
      .toLowerCase()
      .replace(/[^a-z0-9_.-]+/g, "_")
      .replace(/^_+/, "")
      .replace(/_+$/, "") || "main"
  );
}

function wrapMethod(
  level: string,
  original: ConsoleMethod,
  writer: (level: string, args: unknown[]) => void,
): ConsoleMethod {
  return (...args: unknown[]): void => {
    writer(level, args);
    original.apply(console, args as []);
  };
}

export function installFileLogTap(): void {
  const envPattern = process.env.PW_FILELOG;
  if (!envPattern) return;

  const pattern: string = envPattern;
  const hasScopeToken = pattern.includes("{scope}");

  // Single-file stream (no {scope} in PW_FILELOG)
  let singleStream: fs.WriteStream | null = null;

  // Multi-file streams (per scope) when {scope} is present
  const streamsByScope = new Map<string, fs.WriteStream>();

  function getSingleStream(): fs.WriteStream | null {
    if (singleStream) return singleStream;
    try {
      singleStream = fs.createWriteStream(pattern, { flags: "a" });
    } catch {
      return null;
    }

    singleStream.on("error", () => {});
    return singleStream;
  }

  function getScopedStream(rawScope: string | null): fs.WriteStream | null {
    if (!hasScopeToken) {
      return getSingleStream();
    }

    const scopeKey = normalizeScopeForFilename(rawScope ?? "main");
    const existing = streamsByScope.get(scopeKey);
    if (existing) return existing;

    const filePath = pattern.replace("{scope}", scopeKey);

    let stream: fs.WriteStream;
    try {
      stream = fs.createWriteStream(filePath, { flags: "a" });
    } catch {
      return null;
    }

    stream.on("error", () => {});
    streamsByScope.set(scopeKey, stream);
    return stream;
  }

  const writeLine = (level: string, args: unknown[]): void => {
    try {
      const payload = formatLine(args);
      const scope = extractScopeFromPayload(payload);
      const stream = getScopedStream(scope);
      if (!stream) return;

      const line = `[${createTimestamp()}] [${level}] ${payload}\n`;
      stream.write(line);
    } catch {
      // Ignore file logging errors.
    }
  };

  const { log, info, warn, error } = console;

  console.log = wrapMethod("log", log, writeLine);
  console.info = wrapMethod("info", info, writeLine);
  console.warn = wrapMethod("warn", warn, writeLine);
  console.error = wrapMethod("error", error, writeLine);
}
