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

  // Character creation aliases (some UI sections use createName/createClassId naming)
  const createName = newCharName;
  const setCreateName = setNewCharName;
  const createClassId = newCharClass;
  const setCreateClassId = setNewCharClass;

  const createCharacterBusy = busy;

  const classOptions: Array<{ id: string; label: string }> = [
    { id: "warrior", label: "Warrior" },
    { id: "mage", label: "Mage" },
    { id: "rogue", label: "Rogue" },
    { id: "virtuoso", label: "Virtuoso" },
    // future: bard, enchanter, etc.
  ];

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
const [spellKind, setSpellKind] = useState<"spells" | "songs" | "all">("spells");
const [spellTarget, setSpellTarget] = useState<string>("");
const [invSearch, setInvSearch] = useState<string>("");
const [equipSearch, setEquipSearch] = useState<string>("");
const [effectsSearch, setEffectsSearch] = useState<string>("");



type SpellMeta = {
  id: string;
  canonicalId?: string;
  name: string;
  minLevel: number;
  cooldownMs: number;
  resourceCost: number;
  resourceKind?: string;
  classId: string;
  isSong?: boolean;
  isEnabled?: boolean;
  targetMode?: string;
  targetHint?: string;
  description?: string;
  grantMinRole?: string;
};

function normalizeSpellMeta(row: any): SpellMeta {
  const r = row ?? {};
  const id = String(r.id ?? "");
  const name = String(r.name ?? id);
  return {
    id,
    name,
    classId: r.classId ?? r.class_id,
    minLevel: r.minLevel ?? r.min_level,
    cooldownMs: r.cooldownMs ?? r.cooldown_ms,
    resourceKind: r.resourceKind ?? r.resource_kind,
    resourceCost: r.resourceCost ?? r.resource_cost,
    isSong: r.isSong ?? r.is_song,
    isEnabled: r.isEnabled ?? r.is_enabled,
    targetMode: r.targetMode ?? r.target_mode,
    grantMinRole: r.grantMinRole ?? r.grant_min_role,
  };
}


const [spellMetaById, setSpellMetaById] = useState<Record<string, SpellMeta>>({});
  const [spellMetaError, setSpellMetaError] = useState<string | null>(null);
const [spellMetaBusy, setSpellMetaBusy] = useState<boolean>(false);

type ItemMeta = {
  id: string;
  kind?: string;
  name?: string | null;
  category?: string | null;
  rarity?: string | null;
  slot?: string | null;
  baseValue?: number | null;
  stackMax?: number | null;
  isEnabled?: boolean | null;
  isDevOnly?: boolean | null;
  grantMinRole?: string | null;
  stats?: any;
  notes?: string | null;
};

const [itemMetaById, setItemMetaById] = useState<Record<string, ItemMeta>>({});
const [itemMetaBusy, setItemMetaBusy] = useState<boolean>(false);

const spellMetaSource = useMemo(
  () => (spellMetaBusy ? "loading" : Object.keys(spellMetaById).length ? "api" : "raw"),
  [spellMetaBusy, spellMetaById]
);

const itemMetaSource = useMemo(
  () => (itemMetaBusy ? "loading" : Object.keys(itemMetaById).length ? "api" : "raw"),
  [itemMetaBusy, itemMetaById]
);

function collectItemIdsFromState(st: any): string[] {
  const ids = new Set<string>();
  const inv = st?.inventory as any;

  // v15: inventory.bags[].slots[]
  if (inv?.bags && Array.isArray(inv.bags)) {
    for (const b of inv.bags) {
      const slots = (b as any)?.slots;
      if (Array.isArray(slots)) {
        for (const s of slots) {
          const id = (s as any)?.itemId;
          if (id) ids.add(String(id));
        }
      }
    }
  }

  // legacy: inventory.bags[].items[]
  if (inv?.bags && Array.isArray(inv.bags)) {
    for (const b of inv.bags) {
      const items = (b as any)?.items;
      if (Array.isArray(items)) {
        for (const it of items) {
          const id = (it as any)?.itemId ?? (it as any)?.id;
          if (id) ids.add(String(id));
        }
      }
    }
  }

  const eq = st?.equipment as any;
  if (eq) {
    if (Array.isArray(eq)) {
      for (const e of eq) {
        const id = (e as any)?.itemId ?? (e as any)?.id;
        if (id) ids.add(String(id));
      }
    } else if (eq?.slots && typeof eq.slots === "object") {
      for (const k of Object.keys(eq.slots)) {
        const it = (eq.slots as any)[k];
        const id = it?.itemId ?? it?.id;
        if (id) ids.add(String(id));
      }
    } else if (typeof eq === "object") {
      for (const k of Object.keys(eq)) {
        const it = (eq as any)[k];
        const id = it?.itemId ?? it?.id;
        if (id) ids.add(String(id));
      }
    }
  }

  return [...ids];
}

async function fetchItemMeta(ids: string[]): Promise<void> {
  const unique = [...new Set(ids)].filter(Boolean);
  const missing = unique.filter((id) => !itemMetaById[id]);
  if (missing.length === 0) return;

  setItemMetaBusy(true);
  try {
    const url = `${API_BASE}/api/items?ids=${encodeURIComponent(missing.join(","))}`;
    const res = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!res.ok) throw new Error(`items meta http ${res.status}`);

    const data = await res.json();
    const rows = Array.isArray(data?.items)
      ? data.items
      : Array.isArray(data)
        ? data
        : [];

    const next: Record<string, ItemMeta> = {};
    for (const r of rows) {
      if (r?.id) next[String(r.id)] = r;
    }

    setItemMetaById((prev) => ({ ...prev, ...next }));
  } catch (err) {
    console.warn("[ui] item meta fetch failed", err);
  } finally {
    setItemMetaBusy(false);
  }
}

useEffect(() => {
  if (!selectedCharState) return;
  const ids = collectItemIdsFromState(selectedCharState);
  fetchItemMeta(ids);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [selectedCharState]);

const knownSpellIds = useMemo(() => {
  const known = (selectedCharState as any)?.spellbook?.known ?? {};
  return Object.keys(known).sort();
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
      if (!res.ok) {
          const msg = `spells meta: HTTP ${res.status}`;
          setSpellMetaError(msg);
          throw new Error(msg);
        }
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
  const refreshTimerRef = useRef<number | null>(null);

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

  const createCharacter = async (e?: React.FormEvent) => {
    e?.preventDefault?.();
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

const scheduleSelectedCharRefresh = () => {
    if (!token || !selectedCharId) return;
    if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = window.setTimeout(() => {
      refreshCharacterState(selectedCharId);
    }, 200);
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
  scheduleSelectedCharRefresh();
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
          {/* CHARACTERS + PLAYER PANELS */}
          <section
            style={{
              border: "1px solid #999",
              borderRadius: 6,
              padding: 12,
              marginTop: 12,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <strong>Characters</strong>
              <button
                onClick={() => void refreshCharacters()}
                style={{
                  padding: "2px 8px",
                  border: "1px solid #999",
                  background: "#fff",
                  borderRadius: 4,
                  cursor: "pointer",
                }}
              >
                Refresh
              </button>
            </div>

            {/* Create */}
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
              <input
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="New character name"
                style={{ padding: "2px 6px", border: "1px solid #999", borderRadius: 4 }}
              />

              <select
                value={createClassId}
                onChange={(e) => setCreateClassId(e.target.value)}
                style={{ padding: "2px 6px", border: "1px solid #999", borderRadius: 4 }}
              >
                {classOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>

              <button
                disabled={!createName.trim() || createCharacterBusy}
                onClick={() => void createCharacter()}
                style={{
                  padding: "2px 8px",
                  border: "1px solid #999",
                  background: createCharacterBusy ? "#eee" : "#fff",
                  borderRadius: 4,
                  cursor: createCharacterBusy ? "default" : "pointer",
                }}
              >
                Create
              </button>
            </div>

            {/* List */}
            <div style={{ marginTop: 8 }}>
              {characters.length === 0 ? (
                <div style={{ opacity: 0.7 }}>No characters yet.</div>
              ) : (
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {characters.map((c) => (
                    <li key={c.id} style={{ margin: "2px 0" }}>
                      <label style={{ cursor: "pointer" }}>
                        <input
                          type="radio"
                          name="selectedCharacter"
                          checked={selectedCharId === c.id}
                          onChange={() => setSelectedCharId(c.id)}
                          style={{ marginRight: 6 }}
                        />
                        <span style={{ fontWeight: 600 }}>{c.name}</span>{" "}
                        <span style={{ opacity: 0.8 }}>
                          — {c.classId} (lvl {c.level}) on {c.shardId}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Player Panels */}
            <div style={{ marginTop: 12 }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Player Panels</div>

              {!selectedCharId ? (
                <div style={{ opacity: 0.7 }}>Select a character to view panels.</div>
              ) : !selectedCharState ? (
                <div style={{ opacity: 0.7 }}>Loading character state…</div>
              ) : (
                <>
                  <div
                    style={{
                      border: "1px solid #999",
                      borderRadius: 6,
                      padding: 10,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <div style={{ marginRight: 8, fontWeight: 700 }}>Player Panels</div>

                      {(["spellbook", "inventory", "equipment", "effects"] as PlayerTab[]).map((t) => (
                        <button
                          key={t}
                          onClick={() => setPlayerTab(t)}
                          style={{
                            padding: "2px 8px",
                            border: "1px solid #999",
                            background: playerTab === t ? "#222" : "#fff",
                            color: playerTab === t ? "#fff" : "#000",
                            borderRadius: 4,
                            cursor: "pointer",
                          }}
                          title={t}
                        >
                          {t === "spellbook" ? "Spellbook" : t === "inventory" ? "Inventory" : t === "equipment" ? "Equipment" : "Effects"}
                        </button>
                      ))}
                    </div>

                    {/* SPELLBOOK */}
                    {playerTab === "spellbook" &&
                      (() => {
                        const state = selectedCharState as any;
                        const nowMs = Date.now();

                        const knownIds = (knownSpellIds ?? []).slice();
                        const filteredIds = knownIds.filter((id) => {
                          const meta = spellMetaById[id];
                          const hay = `${id} ${meta?.name ?? ""} ${meta?.canonicalId ?? ""}`.toLowerCase();
                          const q = (spellSearch ?? "").trim().toLowerCase();
                          return q ? hay.includes(q) : true;
                        });

                        const getCooldownRemainingMs = (spellId: string): number => {
                          const cd = state?.progression?.cooldowns?.spells?.[spellId];
                          if (!cd) return 0;
                          const readyAt = Number(cd.readyAtMs ?? 0);
                          const remaining = readyAt - nowMs;
                          return remaining > 0 ? remaining : 0;
                        };

                        const fmtMs = (ms: number): string => {
                          if (ms <= 0) return "ready";
                          const s = Math.ceil(ms / 1000);
                          if (s < 60) return `${s}s`;
                          const m = Math.floor(s / 60);
                          const rs = s % 60;
                          return `${m}m${String(rs).padStart(2, "0")}s`;
                        };

                        const makeCastCmd = (spellId: string): string => {
                          const target = (spellTarget ?? "").trim();
                          return target ? `cast ${spellId} ${target}` : `cast ${spellId}`;
                        };

                        return (
                          <div style={{ marginTop: 10 }}>
                            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                              <input
                                value={spellSearch}
                                onChange={(e) => setSpellSearch(e.target.value)}
                                placeholder="search spells…"
                                style={{ padding: "2px 6px", border: "1px solid #999", borderRadius: 4, width: 220 }}
                              />

                              <span style={{ opacity: 0.8 }}>
                                known: <strong>{knownIds.length}</strong>
                              </span>

                              <input
                                value={spellTarget}
                                onChange={(e) => setSpellTarget(e.target.value)}
                                placeholder="optional target (self, rat.1, etc)"
                                style={{ padding: "2px 6px", border: "1px solid #999", borderRadius: 4, width: 260 }}
                              />

                              <span style={{ opacity: 0.75, fontSize: 12 }}>
                                meta: <strong>{spellMetaBusy ? "loading…" : spellMetaSource}</strong>
                              </span>
                            </div>

                            <div style={{ marginTop: 8 }}>
                              {filteredIds.length === 0 ? (
                                <div style={{ opacity: 0.7 }}>No spells match.</div>
                              ) : (
                                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                  {filteredIds.map((id) => {
                                    const meta = spellMetaById[id];
                                    const cdMs = getCooldownRemainingMs(id);
                                    const status = fmtMs(cdMs);

                                    const lineName = meta?.name ?? meta?.canonicalId ?? id;
                                    const minLevel = meta?.minLevel != null ? Number(meta.minLevel) : undefined;
                                    const cooldownMs = meta?.cooldownMs != null ? Number(meta.cooldownMs) : undefined;
                                    const cost = meta?.resourceCost != null ? Number(meta.resourceCost) : undefined;

                                    return (
                                      <div
                                        key={id}
                                        style={{
                                          display: "flex",
                                          alignItems: "center",
                                          gap: 10,
                                          borderTop: "1px solid #ddd",
                                          paddingTop: 6,
                                        }}
                                      >
                                        <div style={{ width: 360, fontFamily: "monospace" }}>
                                          <span style={{ opacity: 0.8 }}>[r{minLevel ?? "?"}]</span>{" "}
                                          <span style={{ fontWeight: 700 }}>{lineName}</span>{" "}
                                          <span style={{ opacity: 0.75 }}>({status})</span>
                                          {cooldownMs != null ? (
                                            <span style={{ opacity: 0.6 }}> • cd {Math.round(cooldownMs / 100) / 10}s</span>
                                          ) : null}
                                          {cost != null ? <span style={{ opacity: 0.6 }}> • cost {cost}</span> : null}
                                        </div>

                                        <button
                                          disabled={cdMs > 0}
                                          onClick={() => void sendMud(makeCastCmd(id))}
                                          style={{
                                            padding: "2px 8px",
                                            border: "1px solid #999",
                                            background: cdMs > 0 ? "#eee" : "#fff",
                                            borderRadius: 4,
                                            cursor: cdMs > 0 ? "default" : "pointer",
                                          }}
                                          title={makeCastCmd(id)}
                                        >
                                          cast
                                        </button>

                                        <button
                                          onClick={() => void copyToClipboard(makeCastCmd(id))}
                                          style={{
                                            padding: "2px 8px",
                                            border: "1px solid #999",
                                            background: "#fff",
                                            borderRadius: 4,
                                            cursor: "pointer",
                                          }}
                                          title="Copy cast command"
                                        >
                                          copy cmd
                                        </button>

                                        <button
                                          onClick={() => void copyToClipboard(String(id))}
                                          style={{
                                            padding: "2px 8px",
                                            border: "1px solid #999",
                                            background: "#fff",
                                            borderRadius: 4,
                                            cursor: "pointer",
                                          }}
                                          title="Copy spell id"
                                        >
                                          copy id
                                        </button>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })()}

                    {/* INVENTORY */}
                    {playerTab === "inventory" &&
                      (() => {
                        const state = selectedCharState as any;
                        const inv = state?.inventory ?? {};
                        const bags: any[] = Array.isArray(inv?.bags) ? inv.bags : [];
                        const q = (invSearch ?? "").trim().toLowerCase();

                        type Row = { bagId: string; slot: number; itemId: string; qty: number };
                        const rows: Row[] = [];

                        for (const b of bags) {
                          const bagId = String(b?.id ?? b?.bagId ?? "");
                          const slots: any[] = Array.isArray(b?.slots) ? b.slots : [];
                          slots.forEach((s: any, idx: number) => {
                            const itemId = s?.itemId ?? s?.id ?? s?.item_id;
                            const qty = Number(s?.qty ?? s?.quantity ?? 1);
                            if (!itemId) return;
                            rows.push({ bagId, slot: idx, itemId: String(itemId), qty });
                          });
                        }

                        const filtered = rows.filter((r) => {
                          const meta = itemMetaById[r.itemId];
                          const hay = `${r.itemId} ${meta?.name ?? ""} ${meta?.rarity ?? ""} ${meta?.kind ?? ""}`.toLowerCase();
                          return q ? hay.includes(q) : true;
                        });

                        return (
                          <div style={{ marginTop: 10 }}>
                            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                              <input
                                value={invSearch}
                                onChange={(e) => setInvSearch(e.target.value)}
                                placeholder="search inventory…"
                                style={{ padding: "2px 6px", border: "1px solid #999", borderRadius: 4, width: 260 }}
                              />
                              <span style={{ opacity: 0.8 }}>
                                items: <strong>{rows.length}</strong>
                              </span>
                              <span style={{ opacity: 0.75, fontSize: 12 }}>
                                meta: <strong>{itemMetaBusy ? "loading…" : itemMetaSource}</strong>
                              </span>
                            </div>

                            <div style={{ marginTop: 8 }}>
                              {filtered.length === 0 ? (
                                <div style={{ opacity: 0.7 }}>No items match.</div>
                              ) : (
                                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                  {filtered.map((it: Row, idx: number) => {
                                    const meta = itemMetaById[it.itemId];
                                    return (
                                      <div
                                        key={`${it.bagId}:${it.slot}:${it.itemId}:${idx}`}
                                        style={{ display: "flex", gap: 10, alignItems: "center", borderTop: "1px solid #ddd", paddingTop: 6 }}
                                      >
                                        <div style={{ width: 84, fontFamily: "monospace", opacity: 0.75 }}>
                                          {it.bagId || "bag"}:{it.slot}
                                        </div>

                                        <div style={{ flex: 1, fontFamily: "monospace" }}>
                                          <span style={{ fontWeight: 700 }}>{meta?.name ?? String(it.itemId)}</span>{" "}
                                          <span style={{ opacity: 0.75 }}>×{it.qty}</span>{" "}
                                          {meta ? <span style={{ opacity: 0.75 }}>• {safeCompact(meta)}</span> : null}
                                        </div>

                                        <button
                                          onClick={() => void copyToClipboard(String(it.itemId))}
                                          style={{
                                            padding: "2px 8px",
                                            border: "1px solid #999",
                                            background: "#fff",
                                            borderRadius: 4,
                                            cursor: "pointer",
                                          }}
                                          title="Copy item id"
                                        >
                                          copy id
                                        </button>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })()}

                    {/* EQUIPMENT */}
                    {playerTab === "equipment" &&
                      (() => {
                        const state = selectedCharState as any;
                        const equip = state?.equipment ?? {};
                        const slots = equip?.slots ?? equip;
                        const entries = Object.entries(slots ?? {}) as Array<[string, any]>;
                        const q = (equipSearch ?? "").trim().toLowerCase();

                        const filtered = entries.filter(([slotName, v]) => {
                          const itemId = v?.itemId ?? v?.id ?? v?.item_id;
                          const meta = itemMetaById[String(itemId ?? "")];
                          const hay = `${slotName} ${itemId ?? ""} ${meta?.name ?? ""} ${meta?.kind ?? ""}`.toLowerCase();
                          return q ? hay.includes(q) : true;
                        });

                        return (
                          <div style={{ marginTop: 10 }}>
                            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                              <input
                                value={equipSearch}
                                onChange={(e) => setEquipSearch(e.target.value)}
                                placeholder="search equipment…"
                                style={{ padding: "2px 6px", border: "1px solid #999", borderRadius: 4, width: 260 }}
                              />
                              <span style={{ opacity: 0.75, fontSize: 12 }}>
                                meta: <strong>{itemMetaBusy ? "loading…" : itemMetaSource}</strong>
                              </span>
                            </div>

                            <div style={{ marginTop: 8 }}>
                              {filtered.length === 0 ? (
                                <div style={{ opacity: 0.7 }}>No equipment slots.</div>
                              ) : (
                                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                  {filtered.map(([slotName, v]) => {
                                    const itemId = v?.itemId ?? v?.id ?? v?.item_id;
                                    const meta = itemId ? itemMetaById[String(itemId)] : undefined;
                                    return (
                                      <div
                                        key={slotName}
                                        style={{ display: "flex", gap: 10, alignItems: "center", borderTop: "1px solid #ddd", paddingTop: 6 }}
                                      >
                                        <div style={{ width: 140, fontFamily: "monospace", opacity: 0.75 }}>
                                          {slotName}
                                        </div>
                                        <div style={{ flex: 1, fontFamily: "monospace" }}>
                                          {itemId ? (
                                            <>
                                              <span style={{ fontWeight: 700 }}>{meta?.name ?? String(itemId)}</span>{" "}
                                              {meta ? <span style={{ opacity: 0.75 }}>• {safeCompact(meta)}</span> : null}
                                            </>
                                          ) : (
                                            <span style={{ opacity: 0.7 }}>(empty)</span>
                                          )}
                                        </div>
                                        {itemId ? (
                                          <button
                                            onClick={() => void copyToClipboard(String(itemId))}
                                            style={{
                                              padding: "2px 8px",
                                              border: "1px solid #999",
                                              background: "#fff",
                                              borderRadius: 4,
                                              cursor: "pointer",
                                            }}
                                            title="Copy item id"
                                          >
                                            copy id
                                          </button>
                                        ) : null}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })()}

                    {/* EFFECTS */}
                    {playerTab === "effects" &&
                      (() => {
                        const state = selectedCharState as any;
                        const nowMs = Date.now();

                        // Canonical (v1.5): progression.statusEffects.active is a map keyed by effectId.
                        const activeMap =
                          state?.progression?.statusEffects?.active ??
                          state?.statusEffects?.active ??
                          state?.combat?.statusEffects?.active ??
                          state?.runtime?.statusEffects?.active ??
                          null;

                        // Legacy shapes (arrays) are still tolerated for older snapshots.
                        const legacyArr =
                          state?.statusEffects ??
                          state?.effects ??
                          state?.combat?.statusEffects ??
                          state?.combat?.effects ??
                          state?.runtime?.statusEffects ??
                          [];

                        const arrFromMap =
                          activeMap && typeof activeMap === "object" && !Array.isArray(activeMap)
                            ? Object.values(activeMap as any)
                            : [];

                        const arr: any[] =
                          arrFromMap.length > 0 ? arrFromMap : Array.isArray(legacyArr) ? legacyArr : [];

                        const q = (effectsSearch ?? "").trim().toLowerCase();

                        const filtered = arr.filter((e: any) => {
                          const id = e?.id ?? e?.effectId ?? e?.statusId ?? "";
                          const name = e?.name ?? "";
                          const tags = Array.isArray(e?.tags) ? e.tags.join(" ") : "";
                          const hay = `${id} ${name} ${tags} ${e?.sourceId ?? ""} ${e?.sourceKind ?? ""}`.toLowerCase();
                          return q ? hay.includes(q) : true;
                        });

                        const fmtMs = (ms: number): string => {
                          if (!Number.isFinite(ms) || ms <= 0) return "0s";
                          const s = Math.ceil(ms / 1000);
                          const m = Math.floor(s / 60);
                          const r = s % 60;
                          if (m <= 0) return `${s}s`;
                          return `${m}m ${r}s`;
                        };

                        // Minimal "effective attributes" readout: only uses modifiers.attributesPct for now.
                        const baseAttrs =
                          state?.attributes && typeof state.attributes === "object" ? (state.attributes as any) : null;

                        const pctByAttr: Record<string, number> = {};
                        if (baseAttrs) {
                          for (const e of arr) {
                            const ap = e?.modifiers?.attributesPct;
                            if (ap && typeof ap === "object") {
                              for (const [k, v] of Object.entries(ap as any)) {
                                const n = Number(v);
                                if (!Number.isFinite(n)) continue;
                                pctByAttr[String(k)] = (pctByAttr[String(k)] ?? 0) + n;
                              }
                            }
                          }
                        }

                        const renderModifierSummary = (mods: any): string => {
                          if (!mods || typeof mods !== "object") return "";
                          const parts: string[] = [];

                          const addPctMap = (label: string, m: any) => {
                            if (!m || typeof m !== "object") return;
                            const inner: string[] = [];
                            for (const [k, v] of Object.entries(m)) {
                              const n = Number(v);
                              if (!Number.isFinite(n) || n === 0) continue;
                              inner.push(`${k} ${(n * 100).toFixed(0)}%`);
                            }
                            if (inner.length) parts.push(`${label}: ${inner.join(", ")}`);
                          };

                          const addFlatMap = (label: string, m: any) => {
                            if (!m || typeof m !== "object") return;
                            const inner: string[] = [];
                            for (const [k, v] of Object.entries(m)) {
                              const n = Number(v);
                              if (!Number.isFinite(n) || n === 0) continue;
                              const sign = n > 0 ? "+" : "";
                              inner.push(`${k} ${sign}${n}`);
                            }
                            if (inner.length) parts.push(`${label}: ${inner.join(", ")}`);
                          };

                          addPctMap("attr%", mods.attributesPct);
                          addFlatMap("attr+", mods.attributesFlat);

                          // Common scalar knobs (we'll evolve these as the combat model grows).
                          const scalarKeys = [
                            "damageTakenPct",
                            "damageDealtPct",
                            "healingDonePct",
                            "healingTakenPct",
                            "mitigationPct",
                            "moveSpeedPct",
                          ];

                          for (const k of scalarKeys) {
                            const n = Number((mods as any)[k]);
                            if (!Number.isFinite(n) || n === 0) continue;
                            parts.push(`${k}: ${(n * 100).toFixed(0)}%`);
                          }

                          // Fallback: show a short JSON if nothing matched.
                          if (parts.length === 0) {
                            try {
                              const j = JSON.stringify(mods);
                              if (j && j !== "{}") parts.push(j.length > 160 ? j.slice(0, 160) + "…" : j);
                            } catch {
                              // ignore
                            }
                          }

                          return parts.join(" • ");
                        };

                        return (
                          <div style={{ marginTop: 10 }}>
                            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                              <input
                                value={effectsSearch}
                                onChange={(e) => setEffectsSearch(e.target.value)}
                                placeholder="search effects…"
                                style={{ padding: "2px 6px", border: "1px solid #999", borderRadius: 4, width: 260 }}
                              />
                              <span style={{ opacity: 0.8 }}>
                                effects: <strong>{arr.length}</strong>
                              </span>
                            </div>

                            {baseAttrs && (
                              <div
                                style={{
                                  marginTop: 10,
                                  border: "1px solid #ddd",
                                  borderRadius: 6,
                                  padding: 10,
                                }}
                              >
                                <div style={{ fontWeight: 700, marginBottom: 6 }}>Effective Attributes</div>
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 10, fontFamily: "monospace" }}>
                                  {Object.keys(baseAttrs)
                                    .sort()
                                    .map((k) => {
                                      const base = Number((baseAttrs as any)[k] ?? 0);
                                      const pct = Number(pctByAttr[k] ?? 0);
                                      const eff = Math.round(base * (1 + pct));
                                      const delta = eff - base;
                                      const deltaStr = delta === 0 ? "" : ` (${delta > 0 ? "+" : ""}${delta})`;
                                      const pctStr = pct === 0 ? "" : ` [${(pct * 100).toFixed(0)}%]`;
                                      return (
                                        <div key={k}>
                                          <span style={{ opacity: 0.75 }}>{k}</span>: {base} → <strong>{eff}</strong>
                                          {deltaStr}
                                          <span style={{ opacity: 0.7 }}>{pctStr}</span>
                                        </div>
                                      );
                                    })}
                                </div>
                                <div style={{ marginTop: 6, opacity: 0.65, fontSize: 12 }}>
                                  Computed from active effects’ <code>modifiers.attributesPct</code> only (MVP UI).
                                </div>
                              </div>
                            )}

                            <div style={{ marginTop: 8 }}>
                              {filtered.length === 0 ? (
                                <div style={{ opacity: 0.7 }}>No effects match.</div>
                              ) : (
                                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                  {filtered.map((e: any, idx: number) => {
                                    const id = e?.id ?? e?.effectId ?? e?.statusId ?? `effect_${idx}`;
                                    const name = e?.name ?? String(id);
                                    const tags = Array.isArray(e?.tags) ? e.tags : [];
                                    const sourceId = e?.sourceId ?? "";
                                    const sourceKind = e?.sourceKind ?? "";
                                    const stackCount = Number(e?.stackCount ?? e?.stacks ?? 1);
                                    const maxStacks = Number(e?.maxStacks ?? 1);

                                    const expiresAt = Number(e?.expiresAtMs ?? e?.expiresAt ?? 0);
                                    const remainingMs = expiresAt > 0 ? Math.max(0, expiresAt - nowMs) : 0;
                                    const hasExpiry = expiresAt > 0;

                                    const modsSummary = renderModifierSummary(e?.modifiers);

                                    return (
                                      <div
                                        key={String(id)}
                                        style={{
                                          borderTop: "1px solid #ddd",
                                          paddingTop: 8,
                                        }}
                                      >
                                        <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                                          <div style={{ fontWeight: 700 }}>{name}</div>
                                          <div style={{ fontFamily: "monospace", opacity: 0.75 }}>{String(id)}</div>

                                          <div style={{ opacity: 0.8 }}>
                                            stacks:{" "}
                                            <strong>
                                              {Number.isFinite(stackCount) ? stackCount : 1}/{Number.isFinite(maxStacks) ? maxStacks : 1}
                                            </strong>
                                          </div>

                                          {hasExpiry && (
                                            <div style={{ opacity: 0.8 }}>
                                              remaining: <strong>{fmtMs(remainingMs)}</strong>
                                            </div>
                                          )}

                                          {(sourceKind || sourceId) && (
                                            <div style={{ opacity: 0.75, fontFamily: "monospace" }}>
                                              src: {sourceKind}
                                              {sourceKind && sourceId ? ":" : ""}
                                              {sourceId}
                                            </div>
                                          )}
                                        </div>

                                        {tags.length > 0 && (
                                          <div style={{ marginTop: 4, display: "flex", gap: 6, flexWrap: "wrap" }}>
                                            {tags.map((t: any) => (
                                              <span
                                                key={String(t)}
                                                style={{
                                                  fontSize: 12,
                                                  padding: "1px 6px",
                                                  border: "1px solid #ccc",
                                                  borderRadius: 999,
                                                  opacity: 0.85,
                                                }}
                                              >
                                                {String(t)}
                                              </span>
                                            ))}
                                          </div>
                                        )}

                                        {modsSummary && (
                                          <div style={{ marginTop: 6, fontFamily: "monospace", fontSize: 12, opacity: 0.85 }}>
                                            {modsSummary}
                                          </div>
                                        )}

                                        {/* Debug: keep a compact raw view for now */}
                                        <details style={{ marginTop: 6 }}>
                                          <summary style={{ cursor: "pointer", opacity: 0.75 }}>raw</summary>
                                          <pre
                                            style={{
                                              marginTop: 6,
                                              background: "#111",
                                              color: "#eee",
                                              padding: 10,
                                              borderRadius: 6,
                                              overflowX: "auto",
                                              fontSize: 12,
                                            }}
                                          >
                                            {JSON.stringify(e, null, 2)}
                                          </pre>
                                        </details>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })()}
                  </div>

                  {/* CharacterState debug (keep until panels stabilize) */}
                  <div
                    style={{
                      marginTop: 10,
                      border: "1px solid #999",
                      borderRadius: 6,
                      padding: 10,
                      background: "#fff",
                    }}
                  >
                    <div style={{ fontWeight: 700, marginBottom: 6 }}>CharacterState v1.5</div>
                    <pre style={{ margin: 0, fontSize: 12, maxHeight: 260, overflow: "auto" }}>
                      {JSON.stringify(selectedCharState, null, 2)}
                    </pre>
                  </div>
                </>
              )}
            </div>
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
