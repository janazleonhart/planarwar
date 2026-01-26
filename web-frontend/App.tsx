// web-frontend/App.tsx
//
// NOTE: This app intentionally avoids heavy routing libs for now.
// We do a tiny pathname switch so we can host multiple UIs (MUD / City Builder / Admin)
// behind a single login + character list.

import { useEffect, useMemo, useRef, useState } from "react";
import { resolveAdminRoleFromFlags, type AdminRole } from "./lib/api";
import { AdminSpawnPointsPage } from "./pages/AdminSpawnPointsPage";
import { AdminQuestsPage } from "./pages/AdminQuestsPage";
import { AdminNpcsPage } from "./pages/AdminNpcsPage";
import { AdminItemsPage } from "./pages/AdminItemsPage";
import { AdminVendorEconomyPage } from "./pages/AdminVendorEconomyPage";
import { AdminVendorAuditPage } from "./pages/AdminVendorAuditPage";
import { AdminHubPage } from "./pages/AdminHubPage";
import { CityShellPage } from "./pages/CityShellPage";
import { ModeHubPage, type AppModeId, type ModeCard } from "./pages/ModeHubPage";

type AuthMode = "login" | "register";

type AccountFlags = {
  isDev?: boolean;
  isGM?: boolean;
  isGuide?: boolean;
  [k: string]: any;
};

type Account = {
  id: string;
  email: string;
  displayName?: string | null;
  createdAt: string;
  // Optional: returned by backend (accounts.flags JSONB). If absent, we treat as non-admin.
  flags?: AccountFlags;
};

type Character = {
  id: string;
  accountId: string;
  name: string;
  classId: string;
  shardId: string;
  level: number;
  createdAt: string;
};

type CharacterState = {
  id: string;
  name: string;
  classId: string;
  level: number;
  shardId: string;
  gold: number;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  roomId: string;
  inventory: any[];
  flags: Record<string, any>;
  createdAt: string;
  updatedAt: string;
  // Runtime payload can include many more fields than this minimal shape.
  // Keep them optional so the UI can safely read newer CharacterState versions.
  spellbook?: {
    known?: Record<string, { rank: number; learnedAt: number }>;
    cooldowns?: Record<string, { readyAt: number }>;
    abilities?: Record<string, any>;
    progression?: any;
  };
  equipment?: any;
  songs?: any;
  gathering?: any;
  exploration?: any;
  powerResources?: any;
  currency?: any;
};


type WsStatus = "disconnected" | "connecting" | "connected" | "error";

type WsLogKind = "system" | "command" | "mud" | "whereami" | "chat" | "world" | "raw";

type WsLogEntry = {
  ts: number;
  kind: WsLogKind;
  text: string;
  op?: string;
  raw?: any;
};


const AUTH_KEY = "pw_auth_v1";
const MODE_KEY = "pw_last_mode_v1";

function getApiBase(): string {
  // Legacy App.tsx behavior: compute from hostname with localhost fallbacks.
  // Admin + city pages should use same-origin /api via Vite proxy; this stays for the MUD console glue.
  const host = window.location.hostname || "localhost";
  const isLocal = host === "localhost" || host === "127.0.0.1";
  return isLocal ? "http://localhost:4000" : `http://${host}:4000`;
}

function getShardWs(): string {
  // Prefer explicit Vite env overrides (useful for prod + tunnels).
  // - VITE_PW_SHARD_WS: full ws(s)://host:port/path
  // - VITE_PW_WS_HOST: host only
  // - VITE_PW_WS_PORT: port only (defaults to 7777, matching worldcore/config)
  // - VITE_PW_WS_PATH: path only (defaults to /ws, matching shard WebSocketServer path)
  const env = (import.meta as any)?.env as Record<string, string | undefined> | undefined;

  const full = env?.VITE_PW_SHARD_WS;
  if (full && typeof full === "string") return full;

  const hostFromEnv = env?.VITE_PW_WS_HOST;
  const host = (hostFromEnv && hostFromEnv.trim()) || window.location.hostname || "localhost";

  const portRaw = env?.VITE_PW_WS_PORT;
  const port = Number(portRaw ?? "7777");
  const path = env?.VITE_PW_WS_PATH ?? "/ws";

  // If the page is served over https, the WS should be wss.
  const proto = window.location.protocol === "https:" ? "wss" : "ws";

  // Ensure path begins with "/"
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;

  return `${proto}://${host}:${port}${normalizedPath}`;
}

const API_BASE = getApiBase();
const SHARD_WS = getShardWs();

function readStoredAuth(): { token: string; account: Account } | null {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.token || !parsed?.account) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeStoredAuth(token: string, account: Account) {
  localStorage.setItem(AUTH_KEY, JSON.stringify({ token, account }));
}

function clearStoredAuth() {
  localStorage.removeItem(AUTH_KEY);
}

function readLastMode(): AppModeId | null {
  const raw = localStorage.getItem(MODE_KEY);
  if (raw === "mud" || raw === "city" || raw === "admin") return raw;
  return null;
}

function writeLastMode(mode: AppModeId) {
  localStorage.setItem(MODE_KEY, mode);
}

function modeFromPath(pathname: string): AppModeId | null {
  if (pathname.startsWith("/admin")) return "admin";
  if (pathname.startsWith("/city")) return "city";
  if (pathname === "/mud") return "mud";
  return null;
}

function pathForMode(mode: AppModeId): string {
  switch (mode) {
    case "mud":
      return "/mud";
    case "city":
      return "/city/me";
    case "admin":
      return "/admin";
    default:
      return "/";
  }
}

function hasHubOverride(): boolean {
  const params = new URLSearchParams(window.location.search);
  return params.get("hub") === "1";
}

function safeParseErrorMessage(txt: string): string {
  // Backend sometimes returns JSON like {"error":"..."} but as text.
  const t = (txt ?? "").trim();
  if (!t) return "Unknown error.";
  if (t.startsWith("{") && t.endsWith("}")) {
    try {
      const j = JSON.parse(t);
      const msg = j?.error ?? j?.message;
      if (typeof msg === "string" && msg.trim()) return msg.trim();
    } catch {
      // ignore
    }
  }
  return t;
}


export function App() {
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [token, setToken] = useState<string>(() => readStoredAuth()?.token ?? "");
  const [account, setAccount] = useState<Account | null>(() => readStoredAuth()?.account ?? null);

  // Login/Register form
  const [emailOrName, setEmailOrName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Character selection + debug state view
  const [characters, setCharacters] = useState<Character[]>([]);
  const [selectedCharId, setSelectedCharId] = useState<string>("");
  const [selectedCharState, setSelectedCharState] = useState<CharacterState | null>(null);
  const [newCharName, setNewCharName] = useState("");
  const [newCharClass, setNewCharClass] = useState("warrior");

  // WebSocket / shard console
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [wsStatus, setWsStatus] = useState<WsStatus>("disconnected");

  // WS log v2: structured entries so we can filter + format (instead of raw JSON spam).
  const [wsLog, setWsLog] = useState<WsLogEntry[]>([]);
  const [logSearch, setLogSearch] = useState<string>("");
  const [logAutoScroll, setLogAutoScroll] = useState<boolean>(true);
  const [logShowKinds, setLogShowKinds] = useState<Record<WsLogKind, boolean>>({
    system: true,
    command: true,
    mud: true,
    whereami: true,
    chat: true,
    world: true,
    raw: false,
  });


// Player panel v1: read-only panels for spellbook/inventory/equipment/effects.
type PlayerTab = "spellbook" | "inventory" | "equipment" | "effects";
const [playerTab, setPlayerTab] = useState<PlayerTab>("spellbook");
const [spellSearch, setSpellSearch] = useState<string>("");


type SpellMeta = {
  id: string;
  name: string;
  minLevel: number;
  cooldownMs: number;
  resourceCost: number;
  classId: string;
  isSong?: boolean;
};

const [spellMetaById, setSpellMetaById] = useState<Record<string, SpellMeta>>({});
const [spellMetaBusy, setSpellMetaBusy] = useState<boolean>(false);

const knownSpellIds = useMemo(() => {
  const known = (selectedCharState as any)?.spellbook?.known ?? {};
  return Object.keys(known);
}, [selectedCharState]);

useEffect(() => {
  if (!token || knownSpellIds.length === 0) {
    setSpellMetaById({});
    return;
  }

  const qs = encodeURIComponent(knownSpellIds.join(","));
  let cancelled = false;

  (async () => {
    try {
      setSpellMetaBusy(true);
      const res = await fetch(`${API_BASE}/api/spells?ids=${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      const rows: SpellMeta[] = Array.isArray(data?.spells) ? data.spells : [];
      const next: Record<string, SpellMeta> = {};
      for (const r of rows) {
        if (r && typeof r.id === "string") next[r.id] = r;
      }
      if (!cancelled) setSpellMetaById(next);
    } catch {
      // ignore: fall back to raw ids
    } finally {
      if (!cancelled) setSpellMetaBusy(false);
    }
  })();

  return () => {
    cancelled = true;
  };
}, [token, knownSpellIds.join(",")]);

  const logRef = useRef<HTMLDivElement | null>(null);

  const safeCompact = (v: any, maxLen = 320) => {
    try {
      const s = typeof v === "string" ? v : JSON.stringify(v);
      if (s.length <= maxLen) return s;
      return s.slice(0, maxLen) + "…";
    } catch {
      return String(v);
    }
  };

  const pushLog = (entry: WsLogEntry) => {
    setWsLog((prev) => {
      const next = prev.length > 2000 ? prev.slice(prev.length - 2000) : prev.slice();
      next.push(entry);
      return next;
    });
  };

  const pushText = (kind: WsLogKind, text: string, op?: string, raw?: any) => {
    pushLog({ ts: Date.now(), kind, text, op, raw });
  };

  const clearLog = () => setWsLog([]);

  const toggleKind = (k: WsLogKind) => setLogShowKinds((prev) => ({ ...prev, [k]: !prev[k] }));

  const formatLogLine = (e: WsLogEntry) => {
    const t = new Date(e.ts).toLocaleTimeString();
    const tag = e.op ? `${e.kind}:${e.op}` : e.kind;
    return `[${t}] [${tag}] ${e.text}`;
  };

  const filteredLogEntries = useMemo(() => {
    const q = logSearch.trim().toLowerCase();
    return wsLog.filter((e) => {
      if (!logShowKinds[e.kind]) return false;
      if (!q) return true;
      return (
        e.text.toLowerCase().includes(q) ||
        (e.op ? e.op.toLowerCase().includes(q) : false) ||
        safeCompact(e.raw, 1000).toLowerCase().includes(q)
      );
    });
  }, [wsLog, logShowKinds, logSearch]);

  const copyVisibleLog = async () => {
    const lines = filteredLogEntries.map((e) => formatLogLine(e)).join("\n");
    try {
      await navigator.clipboard.writeText(lines);
      pushText("system", "[ui] copied visible log to clipboard");
    } catch {
      pushText("system", "[ui] failed to copy (clipboard blocked)");
    }
  };
  const pathname = window.location.pathname;
  const currentMode = useMemo(() => modeFromPath(pathname), [pathname]);

  const adminRole = useMemo<AdminRole | null>(() => resolveAdminRoleFromFlags(account?.flags), [account]);
  const isAdmin = adminRole !== null;

  const appendLog = (line: string) => {
    // Back-compat helper used by legacy calls inside this file.
    pushText("raw", line);
  };

  // Persist last mode on load (so refresh keeps your place).
  useEffect(() => {
    const m = modeFromPath(window.location.pathname);
    if (m) writeLastMode(m);
  }, []);

  // Auto-resume after login: if you land on / (launcher) and you have a last mode, jump there.
  useEffect(() => {
    if (!account) return;
    if (hasHubOverride()) return;
    if (window.location.pathname !== "/") return;

    const last = readLastMode();
    if (!last) return;

    // If the last mode was admin but you don't have the flags, do NOT auto-teleport into a 403 wall.
    if (last === "admin" && !isAdmin) return;

    window.location.assign(pathForMode(last));
  }, [account, isAdmin]);

  const go = (path: string, modeHint?: AppModeId) => {
    if (modeHint) writeLastMode(modeHint);
    window.location.assign(path);
  };

  const logout = () => {
    clearStoredAuth();
    setToken("");
    setAccount(null);
    setCharacters([]);
    setSelectedCharId("");
    setSelectedCharState(null);
    setWsLog([]);
    disconnectFromShard();
    window.location.assign("/?hub=1");
  };

  const refreshCharacters = async () => {
    if (!token) return;
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/characters`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { characters: Character[] };
      setCharacters(data.characters ?? []);
      // Keep selection stable if possible.
      if (data.characters?.length && !selectedCharId) {
        setSelectedCharId(data.characters[0].id);
      }
    } catch (err: any) {
      console.error(err);
      setError(err?.message ?? "Failed to fetch characters.");
    }
  };

  const refreshCharacterState = async (charId: string) => {
    if (!token || !charId) return;
    try {
      const res = await fetch(`${API_BASE}/api/characters/${charId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { character: CharacterState };
      setSelectedCharState(data.character ?? null);
    } catch (err: any) {
      console.error(err);
      // State view is debug-only; don't hard-fail the whole UI for this.
      setSelectedCharState(null);
    }
  };

  useEffect(() => {
    if (token) void refreshCharacters();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (!selectedCharId) {
      setSelectedCharState(null);
      return;
    }
    void refreshCharacterState(selectedCharId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCharId]);

  // Scroll ws log to bottom
  useEffect(() => {
    if (!logRef.current) return;
    if (!logAutoScroll) return;
    logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [filteredLogEntries, logAutoScroll]);

  const submitAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const endpoint = authMode === "register" ? "/api/auth/register" : "/api/auth/login";

      // ✅ IMPORTANT:
      // Backend expects { emailOrName, password } for login now.
      // Register still expects { email, password, displayName }.
      const body =
        authMode === "register"
          ? { email: emailOrName, password, displayName }
          : { emailOrName, password };

      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const txt = await res.text();
        throw new Error(safeParseErrorMessage(txt) || `HTTP ${res.status}`);
      }

      const data = (await res.json()) as { token: string; account: Account };
      setToken(data.token);
      setAccount(data.account);
      writeStoredAuth(data.token, data.account);

      // Post-auth housekeeping
      await refreshCharacters();
    } catch (err: any) {
      console.error(err);
      setError(err?.message ?? "Auth failed.");
    } finally {
      setBusy(false);
    }
  };

  const createCharacter = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;

    setBusy(true);
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/api/characters`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name: newCharName, classId: newCharClass }),
      });

      if (!res.ok) throw new Error(await res.text());

      setNewCharName("");
      await refreshCharacters();
    } catch (err: any) {
      console.error(err);
      setError(err?.message ?? "Failed to create character.");
    } finally {
      setBusy(false);
    }
  };

  const connectToShard = async () => {
    if (!token || !selectedCharId) return;

    try {
      setWsStatus("connecting");

      const socket = new WebSocket(
        `${SHARD_WS}?token=${encodeURIComponent(token)}&characterId=${encodeURIComponent(selectedCharId)}`
      );

      socket.onopen = () => {
        setWsStatus("connected");
        appendLog("[ws] connected");
      };

      socket.onmessage = (evt) => {
        // Most shard messages are JSON { op, payload }. Some browsers deliver Blob/ArrayBuffer.
        const handleText = (text: string) => {
          // Most messages should be JSON. If not, we still print it.
          try {
            const msg = JSON.parse(text);
            const op = String(msg?.op ?? "unknown");
            const payload = msg?.payload;

            // Common op aliases across eras.
            if (op === "mud" || op === "mud_result") {
              pushText("mud", String(payload?.text ?? ""), op, payload);
              return;
            }

            if (op === "whereami" || op === "whereami_result") {
              pushText("whereami", safeCompact(payload, 800), op, payload);
              return;
            }

            if (op === "chat") {
              pushText("chat", String(payload?.text ?? ""), op, payload);
              return;
            }

            // Common world spam: compress it into readable one-liners.
            if (op === "entity_spawn") {
              const id = payload?.id ?? payload?.entityId ?? "?";
              const typ = payload?.type ?? "?";
              const roomId = payload?.roomId ?? "?";
              pushText("world", `spawn ${typ} ${id} @ ${roomId}`, op, payload);
              return;
            }

            if (op === "entity_despawn") {
              const id = payload?.id ?? payload?.entityId ?? "?";
              pushText("world", `despawn ${id}`, op, payload);
              return;
            }

            if (op === "entity_update") {
              const id = payload?.id ?? payload?.entityId ?? "?";
              pushText(
                "world",
                `update ${id} ${safeCompact(payload?.patch ?? payload, 240)}`,
                op,
                payload
              );
              return;
            }

            // Unknown op: show compact payload, keep raw attached for optional viewing.
            pushText("raw", `${op} ${safeCompact(payload, 600)}`, op, payload);
          } catch {
            // Non-JSON: show as-is
            pushText("raw", text);
          }
        };

        try {
          if (typeof evt.data === "string") {
            handleText(evt.data);
            return;
          }

          // Blob (Chrome/Edge sometimes)
          if (typeof Blob !== "undefined" && evt.data instanceof Blob) {
            evt.data
              .text()
              .then(handleText)
              .catch(() => pushText("raw", "[ws] <blob message: failed to read>"));
            return;
          }

          // ArrayBuffer
          if (evt.data instanceof ArrayBuffer) {
            const text = new TextDecoder().decode(evt.data);
            handleText(text);
            return;
          }

          // Fallback
          pushText("raw", String(evt.data));
        } catch (err) {
          pushText("raw", `[ws] message handler error: ${String(err)}`);
        }
      };

      socket.onerror = () => setWsStatus("error");

      socket.onclose = () => {
        setWsStatus("disconnected");
        appendLog("[ws] disconnected");
      };

      setWs(socket);
    } catch (err: any) {
      console.error(err);
      setWsStatus("error");
      appendLog(`[ws] error: ${err?.message ?? String(err)}`);
    }
  };

  const disconnectFromShard = () => {
    try {
      ws?.close();
    } catch {
      // ignore
    }
    setWs(null);
    setWsStatus("disconnected");
  };

  const requestWhereAmI = () => {
    if (!ws || wsStatus !== "connected") return;
    ws.send(JSON.stringify({ op: "whereami", payload: {} }));
  };

const sendMud = (text: string) => {
  const value = text.trim();
  if (!value) return;
  if (wsStatus !== "connected" || !ws) {
    pushText("system", "[ui] not connected");
    return;
  }

  ws.send(
    JSON.stringify({
      op: "mud",
      payload: { text: value },
    })
  );

  pushText("command", `> ${value}`);
};

const copyToClipboard = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text);
    pushText("system", "[ui] copied to clipboard");
  } catch {
    pushText("system", "[ui] failed to copy (clipboard blocked)");
  }
};


  // -----------------------------------------
  // Tiny “router” (pathname switch)
  // -----------------------------------------

  const adminPage = useMemo(() => {
    if (!pathname.startsWith("/admin")) return null;

    // Client-side UX gate (server still enforces the real rule).
    if (!isAdmin) {
      return (
        <div style={{ padding: 16 }}>
          <h2 style={{ marginTop: 0 }}>Admin tools are locked</h2>
          <p style={{ opacity: 0.85, maxWidth: 760 }}>
            Your account doesn’t have admin flags (<code>isDev</code>/<code>isGM</code>/<code>isGuide</code>),
            so the Admin UI is hidden and this route is blocked client-side.
          </p>
          <p style={{ opacity: 0.85, maxWidth: 760 }}>
            If you believe this is wrong, log in with your admin test account (the one that has flags set in
            <code> accounts.flags</code>).
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={() => go("/?hub=1")}>Back to Modes</button>
            <button onClick={() => go("/city/me", "city")}>Go to City</button>
            <button onClick={() => go("/mud", "mud")}>Go to MUD</button>
          </div>
        </div>
      );
    }

    if (pathname === "/admin" || pathname === "/admin/") {
      return <AdminHubPage onGo={(p) => go(p, "admin")} role={adminRole} />;
    }

    if (pathname.startsWith("/admin/spawn_points")) return <AdminSpawnPointsPage />;
    if (pathname.startsWith("/admin/quests")) return <AdminQuestsPage />;
    if (pathname.startsWith("/admin/npcs")) return <AdminNpcsPage />;
    if (pathname.startsWith("/admin/items")) return <AdminItemsPage />;
    if (pathname.startsWith("/admin/vendor_economy")) return <AdminVendorEconomyPage />;
    if (pathname.startsWith("/admin/vendor_audit")) return <AdminVendorAuditPage />;

    return (
      <div style={{ padding: 16 }}>
        <h2>Unknown admin route</h2>
        <p>
          <code>{pathname}</code>
        </p>
        <button onClick={() => go("/admin", "admin")}>Back to Admin Hub</button>
      </div>
    );
  }, [pathname, isAdmin, adminRole]);

  const cityPage = useMemo(() => {
    if (!pathname.startsWith("/city")) return null;

    // Normalize /city -> /city/me
    if (pathname === "/city" || pathname === "/city/") {
      // Keep it simple: hard redirect.
      window.location.assign("/city/me");
      return null;
    }

    return <CityShellPage path={pathname} onGo={(p) => go(p, "city")} />;
  }, [pathname]);

  const isLauncher = pathname === "/";
  const isMud = pathname === "/mud";

  // Cards shown on the launcher.
  const modeCards: ModeCard[] = useMemo(() => {
    const cards: ModeCard[] = [
      {
        id: "mud",
        title: "MUD",
        description: "Text-first gameplay loop: move, fight, gather, quests, economy, and all the weirdness.",
        path: "/mud",
        enabled: true,
      },
      {
        id: "city",
        title: "City Builder",
        description: "Account-owned city management demo UI. Buildings/tech/armies/heroes/policies.",
        path: "/city/me",
        enabled: true,
      },
    ];

    // ✅ Hide Admin mode entirely unless your account has flags.
    if (isAdmin) {
      cards.push({
        id: "admin",
        title: `Admin Tools (${adminRole})`,
        description: "Spawn points, quests, items, NPCs, vendor economy + audit.",
        path: "/admin",
        enabled: true,
      });
    }

    return cards;
  }, [isAdmin, adminRole]);

  // Top nav appears when logged in
  const showTopNav = Boolean(account);

  // -----------------------------------------
  // Render
  // -----------------------------------------

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: 16 }}>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "grid", gap: 4 }}>
          <h1 style={{ margin: 0 }}>Planar War Console</h1>
          <div style={{ fontSize: 12, opacity: 0.75 }}>
            Modes: MUD / City Builder / Admin • API: <code>{API_BASE}</code> • WS: <code>{SHARD_WS}</code>
          </div>
        </div>

        {account ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <div style={{ fontSize: 12, opacity: 0.85 }}>
              <strong>{account.displayName || account.email}</strong>
              {isAdmin && (
                <span style={{ marginLeft: 8, fontSize: 11, opacity: 0.85 }}>
                  <code>role:{adminRole}</code>
                </span>
              )}
            </div>
            <button type="button" onClick={logout}>
              Logout
            </button>
          </div>
        ) : (
          <div style={{ fontSize: 12, opacity: 0.8, alignSelf: "center" }}>
            Not logged in.
          </div>
        )}
      </header>

      {showTopNav && (
        <nav
          style={{
            marginTop: 12,
            padding: 10,
            border: "1px solid #333",
            borderRadius: 12,
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <button type="button" onClick={() => go("/?hub=1")} style={{ fontWeight: 800 }}>
            Modes
          </button>
          <span style={{ opacity: 0.5 }}>•</span>
          <button type="button" onClick={() => go("/mud", "mud")} disabled={currentMode === "mud"}>
            MUD
          </button>
          <button type="button" onClick={() => go("/city/me", "city")} disabled={currentMode === "city"}>
            City
          </button>

          {/* ✅ Hide Admin tab unless allowed */}
          {isAdmin && (
            <button type="button" onClick={() => go("/admin", "admin")} disabled={currentMode === "admin"}>
              Admin
            </button>
          )}

          <span style={{ marginLeft: "auto", fontSize: 12, opacity: 0.7 }}>
            Last mode: <code>{readLastMode() ?? "none"}</code>
          </span>
        </nav>
      )}

      {/* AUTH SECTION */}
      {!account && (
        <section
          style={{
            border: "1px solid #444",
            borderRadius: 8,
            padding: 16,
            marginTop: 16,
          }}
        >
          <header style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <button type="button" onClick={() => setAuthMode("login")} disabled={authMode === "login"}>
              Login
            </button>
            <button type="button" onClick={() => setAuthMode("register")} disabled={authMode === "register"}>
              Register
            </button>
          </header>

          <form onSubmit={submitAuth}>
            <div style={{ marginBottom: 8 }}>
              <label>
                {authMode === "register" ? "Email" : "Email or Display Name"}{" "}
                <input
                  type={authMode === "register" ? "email" : "text"}
                  value={emailOrName}
                  onChange={(e) => setEmailOrName(e.target.value)}
                  required
                />
              </label>
            </div>

            {authMode === "register" && (
              <div style={{ marginBottom: 8 }}>
                <label>
                  Display Name{" "}
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                  />
                </label>
              </div>
            )}

            <div style={{ marginBottom: 8 }}>
              <label>
                Password{" "}
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </label>
            </div>

            <button type="submit" disabled={busy}>
              {authMode === "register" ? "Register" : "Login"}
            </button>
          </form>

          {error && <p style={{ color: "red", marginTop: 8 }}>Error: {error}</p>}
          {busy && <p style={{ marginTop: 8 }}>Working...</p>}
        </section>
      )}

      {/* LAUNCHER */}
      {account && isLauncher && (
        <section
          style={{
            border: "1px solid #444",
            borderRadius: 12,
            padding: 16,
            marginTop: 16,
          }}
        >
          <ModeHubPage cards={modeCards} onPick={(m) => go(pathForMode(m), m)} />
        </section>
      )}

      {/* ADMIN */}
      {account && adminPage && (
        <section
          style={{
            border: "1px solid #444",
            borderRadius: 12,
            padding: 16,
            marginTop: 16,
          }}
        >
          {adminPage}
        </section>
      )}

      {/* CITY */}
      {account && cityPage && (
        <section
          style={{
            border: "1px solid #444",
            borderRadius: 12,
            padding: 16,
            marginTop: 16,
          }}
        >
          {cityPage}
        </section>
      )}

      {/* MUD */}
      {account && isMud && (
        <>
          {/* CHARACTERS SECTION */}
          <section
            style={{
              border: "1px solid #444",
              borderRadius: 8,
              padding: 16,
              marginTop: 16,
            }}
          >
            <header
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 8,
              }}
            >
              <strong>Characters</strong>
              <button type="button" onClick={refreshCharacters} disabled={busy}>
                Refresh
              </button>
            </header>

            <form onSubmit={createCharacter} style={{ marginBottom: 12 }}>
              <input
                type="text"
                placeholder="New character name"
                value={newCharName}
                onChange={(e) => setNewCharName(e.target.value)}
                style={{ marginRight: 8 }}
              />
              <select
                value={newCharClass}
                onChange={(e) => setNewCharClass(e.target.value)}
                style={{ marginRight: 8 }}
              >
                <option value="warrior">Warrior</option>
                <option value="mage">Mage</option>
                <option value="rogue">Rogue</option>
                <option value="virtuoso">Virtuoso</option>
                {/* later: bard, enchanter, etc. */}
              </select>
              <button type="submit" disabled={busy || !newCharName}>
                Create
              </button>
            </form>


<div
  style={{
    marginTop: 12,
    padding: 12,
    border: "1px solid #333",
    borderRadius: 8,
  }}
>
  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
    <div style={{ fontWeight: 700, marginRight: 8 }}>Player Panels</div>

    {(
      [
        ["spellbook", "Spellbook"],
        ["inventory", "Inventory"],
        ["equipment", "Equipment"],
        ["effects", "Effects"],
      ] as const
    ).map(([k, label]) => (
      <button
        key={k}
        type="button"
        onClick={() => setPlayerTab(k)}
        style={{
          padding: "4px 10px",
          border: "1px solid #333",
          borderRadius: 6,
          background: playerTab === k ? "#222" : "transparent",
          color: "inherit",
          cursor: "pointer",
        }}
      >
        {label}
      </button>
    ))}
  </div>

  {playerTab === "spellbook" && (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input
          type="text"
          value={spellSearch}
          onChange={(e) => setSpellSearch(e.target.value)}
          placeholder="search spells…"
          style={{
            padding: "6px 8px",
            fontFamily: "monospace",
            minWidth: 240,
          }}
        />
        <div style={{ opacity: 0.75, fontFamily: "monospace" }}>
          known: {Object.keys(selectedCharState?.spellbook?.known ?? {}).length} {spellMetaBusy ? "(meta…)" : ""}
        </div>
      </div>

      <div style={{ marginTop: 10, fontFamily: "monospace", fontSize: 12 }}>
        {(() => {
          const now = Date.now();
          const known = selectedCharState?.spellbook?.known ?? {};
          const cooldowns = selectedCharState?.spellbook?.cooldowns ?? {};
          const q = spellSearch.trim().toLowerCase();

          const rows = Object.entries(known)
            .map(([id, info]) => {
              const cd = cooldowns[id];
              const readyAt = cd?.readyAt ?? 0;
              const remainingMs = Math.max(0, readyAt - now);
              const meta = spellMetaById[id];

              return {
                id,
                name: meta?.name ?? null,
                minLevel: typeof meta?.minLevel === "number" ? meta.minLevel : null,
                rank: (info as any)?.rank ?? 1,
                readyAt,
                remainingMs,
              };
            })
            .filter((r) => {
              if (!q) return true;
              const idOk = r.id.toLowerCase().includes(q);
              const nameOk = (r.name ?? "").toLowerCase().includes(q);
              return idOk || nameOk;
            })
            .sort((a, b) => a.id.localeCompare(b.id));
if (!selectedCharState) {
            return <div style={{ opacity: 0.8 }}>No character selected.</div>;
          }

          if (rows.length === 0) {
            return <div style={{ opacity: 0.8 }}>No spells match.</div>;
          }

          return (
            <div style={{ display: "grid", gap: 6 }}>
              {rows.map((r) => {
                const castCmd = `cast ${r.id}`;
                const cooldownText =
                  r.remainingMs > 0 ? `CD ${(r.remainingMs / 1000).toFixed(1)}s` : "ready";
                return (
                  <div
                    key={r.id}
                    style={{
                      display: "flex",
                      gap: 10,
                      alignItems: "center",
                      flexWrap: "wrap",
                      borderTop: "1px solid #222",
                      paddingTop: 6,
                    }}
                  >
                    <div style={{ minWidth: 260 }}>
                      <span style={{ opacity: 0.8 }}>[r{r.rank}]</span>{" "}
                      <span style={{ fontWeight: 600 }}>{r.name ?? r.id}</span> {r.name && r.name !== r.id ? <span style={{ opacity: 0.6 }}>({r.id})</span> : null}{" "}
                      <span style={{ opacity: 0.8 }}>({cooldownText})</span> {typeof r.minLevel === "number" ? <span style={{ opacity: 0.6 }}> • L{r.minLevel}</span> : null}
                    </div>

                    <button type="button" onClick={() => sendMud(castCmd)}>
                      cast
                    </button>
                    <button type="button" onClick={() => copyToClipboard(castCmd)}>
                      copy cmd
                    </button>
                    <button type="button" onClick={() => copyToClipboard(r.id)}>
                      copy id
                    </button>
                  </div>
                );
              })}
            </div>
          );
        })()}
      </div>
    </div>
  )}

  {playerTab === "inventory" && (
    <div style={{ marginTop: 10 }}>
      <div style={{ opacity: 0.75, marginBottom: 6 }}>
        (read-only) Inventory snapshot from CharacterState.
      </div>
      <pre style={{ whiteSpace: "pre-wrap", margin: 0, fontSize: 12 }}>
        {JSON.stringify(selectedCharState?.inventory ?? null, null, 2)}
      </pre>
    </div>
  )}

  {playerTab === "equipment" && (
    <div style={{ marginTop: 10 }}>
      <div style={{ opacity: 0.75, marginBottom: 6 }}>
        (read-only) Equipment snapshot from CharacterState.
      </div>
      <pre style={{ whiteSpace: "pre-wrap", margin: 0, fontSize: 12 }}>
        {JSON.stringify((selectedCharState as any)?.equipment ?? null, null, 2)}
      </pre>
    </div>
  )}

  {playerTab === "effects" && (
    <div style={{ marginTop: 10 }}>
      <div style={{ opacity: 0.75, marginBottom: 6 }}>
        (read-only) Effects snapshot from CharacterState.
      </div>
      <pre style={{ whiteSpace: "pre-wrap", margin: 0, fontSize: 12 }}>
        {JSON.stringify((selectedCharState as any)?.exploration?.statusEffects ?? null, null, 2)}
      </pre>
    </div>
  )}
</div>

            <div
              style={{
                marginTop: 12,
                padding: 12,
                border: "1px solid #333",
                borderRadius: 8,
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 8 }}>CharacterState v1.5</div>
              {selectedCharState ? (
                <pre style={{ whiteSpace: "pre-wrap", margin: 0, fontSize: 12 }}>
                  {JSON.stringify(selectedCharState, null, 2)}
                </pre>
              ) : (
                <div style={{ opacity: 0.8 }}>No character selected / state not loaded.</div>
              )}
            </div>

            {characters.length === 0 ? (
              <p>No characters yet.</p>
            ) : (
              <ul>
                {characters.map((c) => (
                  <li key={c.id}>
                    <label style={{ cursor: "pointer" }}>
                      <input
                        type="radio"
                        name="selectedChar"
                        value={c.id}
                        checked={selectedCharId === c.id}
                        onChange={() => setSelectedCharId(c.id)}
                        style={{ marginRight: 6 }}
                      />
                      <strong>{c.name}</strong> — {c.classId} (lvl {c.level}) on {c.shardId}
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* SHARD CONNECTION SECTION */}
          <section
            style={{
              border: "1px solid #444",
              borderRadius: 8,
              padding: 16,
              marginTop: 16,
            }}
          >
            <header
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 8,
              }}
            >
              <strong>Shard Connection</strong>
              <span>Status: {wsStatus}</span>
            </header>

            <div style={{ marginBottom: 8 }}>
              <button
                type="button"
                onClick={connectToShard}
                disabled={!selectedCharId || !token}
                style={{ marginRight: 8 }}
              >
                Connect with selected character
              </button>
              <button
                type="button"
                onClick={disconnectFromShard}
                disabled={!ws}
                style={{ marginRight: 8 }}
              >
                Disconnect
              </button>
              <button disabled={wsStatus !== "connected"} onClick={requestWhereAmI}>
                Where am I?
              </button>
            </div>

            <input
              type="text"
              placeholder="mud command (look, inspect_region)"
              style={{
                width: "100%",
                marginBottom: 8,
                padding: "6px 8px",
                fontFamily: "monospace",
              }}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;

                const value = (e.target as HTMLInputElement).value.trim();
                if (!value) return;

                (e.target as HTMLInputElement).value = "";

                sendMud(value);
              }}
            />

            

            <div
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                flexWrap: "wrap",
                marginBottom: 8,
              }}
            >
              <input
                type="text"
                value={logSearch}
                onChange={(e) => setLogSearch(e.target.value)}
                placeholder="filter log (op/text)…"
                style={{
                  padding: "6px 8px",
                  fontFamily: "monospace",
                  minWidth: 240,
                }}
              />

              <button type="button" onClick={clearLog}>
                Clear
              </button>
              <button type="button" onClick={copyVisibleLog}>
                Copy visible
              </button>

              <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <input
                  type="checkbox"
                  checked={logAutoScroll}
                  onChange={() => setLogAutoScroll((v) => !v)}
                />
                Auto-scroll
              </label>

              <span style={{ opacity: 0.7 }}>Show:</span>

              {(["system","command","mud","whereami","chat","world","raw"] as WsLogKind[]).map((k) => (
                <label key={k} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={logShowKinds[k]}
                    onChange={() => toggleKind(k)}
                  />
                  {k}
                </label>
              ))}
            </div>
<div
              ref={logRef}
              style={{
                border: "1px solid #333",
                borderRadius: 4,
                padding: 8,
                maxHeight: 360,
                overflowY: "auto",
                fontFamily: "monospace",
                fontSize: "0.85rem",
                background: "#111",
                color: "#ddd",
              }}
            >
              {filteredLogEntries.length === 0 ? (
                <div style={{ opacity: 0.7 }}>
                  No messages yet. (Tip: toggle <code>world</code> / <code>raw</code> when spam gets loud.)
                </div>
              ) : (
                filteredLogEntries.map((e, idx) => (
                  <div key={idx} style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                    <span style={{ opacity: 0.6 }}>[{new Date(e.ts).toLocaleTimeString()}]</span>{" "}
                    <span style={{ opacity: 0.85 }}>[{e.op ? `${e.kind}:${e.op}` : e.kind}]</span>{" "}
                    <span>{e.text}</span>
                    {logShowKinds.raw && e.raw !== undefined && (
                      <details style={{ marginTop: 2, marginLeft: 16, opacity: 0.95 }}>
                        <summary style={{ cursor: "pointer" }}>raw payload</summary>
                        <pre style={{ margin: "6px 0 0 0", overflowX: "auto" }}>
                          {JSON.stringify(e.raw, null, 2)}
                        </pre>
                      </details>
                    )}
                  </div>
                ))
              )}
            </div>

            {error && <p style={{ color: "red", marginTop: 8 }}>Error: {error}</p>}
          </section>
        </>
      )}

      {/* Unknown route fallback (logged in) */}
      {account && !isLauncher && !adminPage && !cityPage && !isMud && (
        <section
          style={{
            border: "1px solid #444",
            borderRadius: 12,
            padding: 16,
            marginTop: 16,
          }}
        >
          <h2>Unknown route</h2>
          <p style={{ opacity: 0.85 }}>
            <code>{pathname}</code>
          </p>
          <button type="button" onClick={() => go("/?hub=1")}>
            Back to Modes
          </button>
        </section>
      )}
    </div>
  );
}

export default App;
