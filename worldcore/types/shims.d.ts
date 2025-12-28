declare module "uuid" {
  export function v4(): string;
}

declare module "ws" {
  export class WebSocket {
    constructor(...args: any[]);
    [key: string]: any;
  }
  export class WebSocketServer {
    constructor(...args: any[]);
    [key: string]: any;
  }
  export type Data = any;
  const ws: any;
  export default ws;
}

declare module "pg" {
  export class Pool {
    constructor(...args: any[]);
    [key: string]: any;
  }
}

declare module "redis" {
  export const createClient: (...args: any[]) => any;
  export type RedisClientType = any;
}

declare module "dotenv" {
  export function config(...args: any[]): void;
}

declare module "jsonwebtoken" {
  const jwt: any;
  export = jwt;
}

declare module "node:test" {
  interface TestFn {
    (name: string, fn: () => any | Promise<any>): Promise<any>;
  }
  const test: TestFn;
  export = test;
}

declare const process: {
  env: Record<string, string | undefined>;
  [key: string]: any;
};

declare const console: {
  log: (...args: any[]) => void;
  info: (...args: any[]) => void;
  warn: (...args: any[]) => void;
  error: (...args: any[]) => void;
  debug: (...args: any[]) => void;
};

declare namespace NodeJS {
  interface Timeout {}
}

declare module "assert" {
  const assert: any;
  export = assert;
}

declare module "node:assert/strict" {
  import assert = require("assert");
  export = assert;
}

declare function setTimeout(
  handler: (...args: any[]) => void,
  timeout?: number,
  ...args: any[]
): any;

declare function clearTimeout(handle?: any): void;

declare function setInterval(
  handler: (...args: any[]) => void,
  timeout?: number,
  ...args: any[]
): any;

declare function clearInterval(handle?: any): void;
