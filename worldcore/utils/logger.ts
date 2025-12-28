// worldcore/utils/logger.ts

import { Colors, colorize, ColorCode } from "./colors";
import { LogLevel, logEnabled } from "../config/logconfig";

export const __LOG_MODULE = true;

function timestamp(): string {
  const d = new Date();
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${h}:${m}:${s}.${ms}`;
}

function levelColor(level: LogLevel): ColorCode {
  switch (level) {
    case "debug":
      return Colors.BrightCyan ?? Colors.FgCyan;
    case "info":
      return Colors.FgGreen;
    case "warn":
      return Colors.FgYellow;
    case "error":
    default:
      return Colors.FgRed;
  }
}

type MetaInput = any[];

function normalizeArgs(args: MetaInput): { message?: string; rest: any[] } {
  if (args.length === 0) {
    return { rest: [] };
  }

  const [first, ...rest] = args;

  if (typeof first === "string") {
    return { message: first, rest };
  }

  return { message: undefined, rest: args };
}

function maybeFormatError(value: any): any {
  if (value instanceof Error) {
    return {
      error: value.message,
      name: value.name,
      stack: value.stack,
    };
  }
  return value;
}

export class Logger {
  private constructor(private scope: string) {}

  static scope(scope: string): Logger {
    return new Logger(scope.toUpperCase());
  }

  private write(level: LogLevel, color: ColorCode, args: MetaInput): void {
    if (!logEnabled(this.scope, level)) return;

    const ts = timestamp();
    const { message, rest } = normalizeArgs(args);

    const tag = colorize(
      `[${this.scope}:${level.toUpperCase()}]`,
      color,
    );

    // If first arg is string, show it inline; otherwise just tag + data.
    if (message !== undefined) {
      if (rest.length === 0) {
        console.log(`${ts} ${tag} ${message}`);
      } else {
        const formattedRest = rest.map(maybeFormatError);
        console.log(`${ts} ${tag} ${message}`, ...formattedRest);
      }
    } else if (rest.length > 0) {
      const formattedRest = rest.map(maybeFormatError);
      console.log(`${ts} ${tag}`, ...formattedRest);
    } else {
      console.log(`${ts} ${tag}`);
    }
  }

  debug(...args: any[]): void {
    this.write("debug", levelColor("debug"), args);
  }

  info(...args: any[]): void {
    this.write("info", levelColor("info"), args);
  }

  warn(...args: any[]): void {
    this.write("warn", levelColor("warn"), args);
  }

  error(...args: any[]): void {
    this.write("error", levelColor("error"), args);
  }

  // Convenience alias – logs at info level but with bright green tag
  success(...args: any[]): void {
    this.write("info", Colors.BrightGreen ?? levelColor("info"), args);
  }
}
