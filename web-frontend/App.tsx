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
};

type WsStatus = "disconnected" | "connecting" | "connected" | "error";

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
  const host = window.location.hostname || "localhost";
  const isLocal = host === "localhost" || host === "127.0.0.1";
  return isLocal ? "ws://localhost:4010" : `ws://${host}:4010`;
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
  const [wsLog, setWsLog] = useState<string[]>([]);
  const logRef = useRef<HTMLDivElement | null>(null);

  const pathname = window.location.pathname;
  const currentMode = useMemo(() => modeFromPath(pathname), [pathname]);

  const adminRole = useMemo<AdminRole | null>(() => resolveAdminRoleFromFlags(account?.flags), [account]);
  const isAdmin = adminRole !== null;

  const appendLog = (line: string) => {
    setWsLog((prev) => {
      const next = [...prev, line];
      return next.length > 200 ? next.slice(next.length - 200) : next;
    });
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
    logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [wsLog]);

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
        `${SHARD_WS}?token=${encodeURIComponent(token)}&charId=${encodeURIComponent(selectedCharId)}`
      );

      socket.onopen = () => {
        setWsStatus("connected");
        appendLog("[ws] connected");
      };

      socket.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          if (msg.op === "mud_result") {
            appendLog(String(msg.payload?.text ?? ""));
            return;
          }
          if (msg.op === "whereami_result") {
            appendLog(`[whereami] ${JSON.stringify(msg.payload)}`);
            return;
          }
          if (msg.op === "chat") {
            appendLog(`[chat] ${msg.payload?.text ?? ""}`);
            return;
          }
          appendLog(`[ws] ${evt.data}`);
        } catch {
          appendLog(String(evt.data));
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

                ws?.send(
                  JSON.stringify({
                    op: "mud",
                    payload: { text: value },
                  })
                );

                appendLog(`> ${value}`);
              }}
            />

            <div
              ref={logRef}
              style={{
                border: "1px solid #333",
                borderRadius: 4,
                padding: 8,
                maxHeight: 200,
                overflowY: "auto",
                fontFamily: "monospace",
                fontSize: "0.85rem",
                background: "#111",
                color: "#ddd",
              }}
            >
              {wsLog.length === 0 ? (
                <div style={{ opacity: 0.7 }}>WebSocket log will appear here…</div>
              ) : (
                wsLog.map((line, idx) => <div key={idx}>{line}</div>)
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
