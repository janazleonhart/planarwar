//worldcore/utils/colors.ts

// Basic ANSI color helpers for Node console output.
// Safe to use from both MMO backend and webend backend.

export const Colors = {
  Reset: "\x1b[0m",

  Bright: "\x1b[1m",
  Dim: "\x1b[2m",

  FgRed: "\x1b[31m",
  FgGreen: "\x1b[32m",
  FgYellow: "\x1b[33m",
  FgBlue: "\x1b[34m",
  FgMagenta: "\x1b[35m",
  FgCyan: "\x1b[36m",
  FgWhite: "\x1b[37m",

  // Bright/“light” variants – keep old names for compatibility
  BrightRed: "\x1b[91m",
  BrightGreen: "\x1b[92m",
  BrightYellow: "\x1b[93m",
  BrightBlue: "\x1b[94m",
  BrightMagenta: "\x1b[95m",
  BrightCyan: "\x1b[96m",
  BrightWhite: "\x1b[97m",
};

export type ColorCode = (typeof Colors)[keyof typeof Colors] | string;

export function colorize(text: string, color?: ColorCode): string {
  if (!color) return text;
  return `${color}${text}${Colors.Reset}`;
}
