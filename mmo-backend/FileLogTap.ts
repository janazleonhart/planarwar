import fs from "fs";
import util from "util";

type ConsoleMethod = (...args: unknown[]) => void;

function serializeArg(arg: unknown): string {
  if (typeof arg === "string") return arg;
  if (arg instanceof Error) return arg.stack ?? arg.message;

  try {
    return JSON.stringify(arg);
  } catch {
    return util.inspect(arg);
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
  writer: (level: string, args: unknown[]) => void
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
    return;
  }

  stream.on("error", () => {
    // Ignore write errors to keep the server running.
  });

  const writeLine = (level: string, args: unknown[]): void => {
    try {
      stream.write(
        `[${createTimestamp()}] [${level}] ${formatLine(args)}\n`
      );
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
