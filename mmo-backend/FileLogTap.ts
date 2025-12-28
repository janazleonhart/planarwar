// mmo-backend/FileLogTap.ts

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
  const filePath = process.env.PW_FILELOG;
  if (!filePath) return;

  let stream: fs.WriteStream;
  try {
    stream = fs.createWriteStream(filePath, { flags: "a" });
  } catch {
    // If we can't open the file, just silently bail; console still works.
    return;
  }

  stream.on("error", () => {
    // Ignore write errors to keep the server running.
  });

  const writeLine = (level: string, args: unknown[]): void => {
    try {
      const payload = formatLine(args);
      const line = `[${createTimestamp()}] [${level}] ${payload}\n`;
      stream.write(line);
    } catch {
      // Ignore write errors to keep the server running.
    }
  };

  const { log, info, warn, error } = console;

  console.log = wrapMethod("log", log, writeLine);
  console.info = wrapMethod("info", info, writeLine);
  console.warn = wrapMethod("warn", warn, writeLine);
  console.error = wrapMethod("error", error, writeLine);
}
