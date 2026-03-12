//web-backend/routes/adminMotherBrain/motherBrainProxy.ts

export type MotherBrainProxyMethod = "GET" | "POST";

export type MotherBrainProxyResult = {
  ok: boolean;
  status: number;
  json: any;
};

export function motherBrainHttpBase(): string | null {
  const explicit = typeof process.env.PW_MOTHER_BRAIN_HTTP_URL === "string" ? process.env.PW_MOTHER_BRAIN_HTTP_URL.trim() : "";
  if (explicit) return explicit.replace(/\/+$/, "");

  const portRaw = process.env.MOTHER_BRAIN_HTTP_PORT;
  const port = portRaw && String(portRaw).trim() !== "" ? Number(portRaw) : NaN;
  if (Number.isFinite(port) && port > 0) {
    const host = typeof process.env.MOTHER_BRAIN_HTTP_HOST === "string" && process.env.MOTHER_BRAIN_HTTP_HOST.trim()
      ? process.env.MOTHER_BRAIN_HTTP_HOST.trim()
      : "127.0.0.1";
    return `http://${host}:${port}`;
  }

  return null;
}

export async function proxyMotherBrain(method: MotherBrainProxyMethod, routePath: string, body?: unknown): Promise<MotherBrainProxyResult> {
  const base = motherBrainHttpBase();
  if (!base) {
    return {
      ok: false,
      status: 409,
      json: {
        ok: false,
        error: "mother_brain_http_proxy_disabled",
        detail: "Set PW_MOTHER_BRAIN_HTTP_URL or MOTHER_BRAIN_HTTP_PORT on web-backend to enable proxy.",
      },
    };
  }

  const url = `${base}${routePath.startsWith("/") ? "" : "/"}${routePath}`;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 2500);

  try {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ac.signal,
    } as any);

    let json: any = null;
    try {
      json = await res.json();
    } catch {
      json = { ok: false, error: "non_json_response" };
    }

    return { ok: res.ok, status: res.status, json };
  } catch (err: unknown) {
    return {
      ok: false,
      status: 502,
      json: {
        ok: false,
        error: "mother_brain_http_proxy_failed",
        detail: err instanceof Error ? err.message : String(err),
      },
    };
  } finally {
    clearTimeout(t);
  }
}
