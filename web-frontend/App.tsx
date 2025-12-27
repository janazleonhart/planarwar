// web-frontend/App.tsx

import { useState, useEffect, useRef } from "react";
import * as React from "react";
import { AdminQuestsPage } from "./pages/AdminQuestsPage";
import { AdminNpcsPage } from "./pages/AdminNpcsPage";
import { AdminItemsPage } from "./pages/AdminItemsPage";

const API_BASE =
  window.location.hostname === "localhost"
    ? "http://localhost:4000"
    : `http://${window.location.hostname}:4000`;
const SHARD_WS =
  window.location.hostname === "localhost"
    ? "ws://localhost:7777/ws"
    : `ws://${window.location.hostname}:7777/ws`;

    async function api<T = any>(
      path: string,
      options: RequestInit = {}
    ): Promise<T> {
      const url = `${API_BASE}${path}`;
    
      // Merge headers, but always keep JSON content-type
      const baseHeaders: Record<string, string> = {
        "Content-Type": "application/json",
      };
    
      const mergedHeaders: HeadersInit = {
        ...baseHeaders,
        ...(options.headers as Record<string, string> | undefined),
      };
    
      const res = await fetch(url, {
        ...options,
        headers: mergedHeaders,
      });
    
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text}`);
      }
    
      // 204 / empty body guard
      const text = await res.text();
      if (!text) return {} as T;
      return JSON.parse(text) as T;
    }

interface Account {
  id: string;
  displayName: string;
  email?: string;
}

interface Character {
  id: string;
  name: string;
  shardId: string;
  classId: string;
  level: number;
  xp?: number;
}

interface CharacterState extends Character {
  userId?: string;
  posX?: number; posY?: number; posZ?: number;
  attributes?: any;
  inventory?: any;
  equipment?: any;
  spellbook?: any;
  abilities?: any;
  progression?: any;
}

type AuthMode = "login" | "register";

function App() {
  // Dev-only admin shortcut: direct URL for quest editor
  const path = window.location.pathname;

  if (path === "/admin/quests" || path === "/admin-quests") {
    return <AdminQuestsPage />;
  }

  if (path === "/admin/npcs") {
    return <AdminNpcsPage />;
  }

  if (path === "/admin/items") {
    return <AdminItemsPage />;
  }

  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");

  const [token, setToken] = useState<string | null>(null);
  const [account, setAccount] = useState<Account | null>(null);

  const [characters, setCharacters] = useState<Character[]>([]);
  const [newCharName, setNewCharName] = useState("");
  const [newCharClass, setNewCharClass] = useState("warrior");
  const [selectedCharState, setSelectedCharState] = useState<CharacterState | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Shard connection state
  const [selectedCharId, setSelectedCharId] = useState<string | null>(null);
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [wsStatus, setWsStatus] =
    useState<"disconnected" | "connecting" | "connected">("disconnected");
  const [wsLog, setWsLog] = useState<string[]>([]);
  
  // instead of the union-style authedHeaders
  const authedHeaders: Record<string, string> = {};
  if (token) {
    authedHeaders["Authorization"] = `Bearer ${token}`;
  }

  function appendLog(line: string) {
    setWsLog((prev) => [...prev, line]);
  }

  // ---------------------------------------------------------------------------
  // Auth
  // ---------------------------------------------------------------------------

  async function handleAuthSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    try {
      if (authMode === "register") {
        const res = await api<{
          ok: boolean;
          account: Account;
          token: string;
        }>("/api/auth/register", {
          method: "POST",
          body: JSON.stringify({ email, displayName, password }),
        });

        persistAuth(res.token, res.account);
      } else {
        const body = { emailOrName: email, password }; // as we already fixed
        const res = await api<{
          ok: boolean;
          account: Account;
          token: string;
        }>("/api/auth/login", {
          method: "POST",
          body: JSON.stringify(body),
        });

        persistAuth(res.token, res.account);
      }
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  function logout() {
    setToken(null);
    setAccount(null);
    setCharacters([]);
    setSelectedCharId(null);
    setWs(null);
    setWsStatus("disconnected");
    setWsLog([]);

    try {
      window.localStorage.removeItem("pw_auth_v1");
    } catch {
      // meh
    }
  }

  function persistAuth(newToken: string, newAccount: Account) {
    setToken(newToken);
    setAccount(newAccount);
  
    try {
      window.localStorage.setItem(
        "pw_auth_v1",
        JSON.stringify({
          token: newToken,
          account: newAccount,
        })
      );
    } catch {
      // non-fatal: if storage explodes, we just lose persistence
    }
  }

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("pw_auth_v1");
      if (!raw) return;
  
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.token === "string" && parsed.account) {
        setToken(parsed.token);
        setAccount(parsed.account as Account);
      }
    } catch {
      // ignore bad data
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Characters
  // ---------------------------------------------------------------------------

  async function refreshCharacters() {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ ok: boolean; characters: Character[] }>(
        "/api/characters",
        {
          headers: authedHeaders,
        }
      );
      setCharacters(res.characters);

      // If we don't have a selected character yet, pick the first one
      if (!selectedCharId && res.characters.length > 0) {
        setSelectedCharId(res.characters[0].id);
      }
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  async function createCharacter(e: React.FormEvent) {
    e.preventDefault();
    if (!token) {
      setError("You must be logged in.");
      return;
    }
  
    setBusy(true);
    setError(null);
  
    try {
      const payload = {
        shardId: "prime_shard",
        name: newCharName.trim() || "Unnamed",
        classId: newCharClass,
      };
  
      console.log("[createCharacter] sending body", payload);
  
      const res = await api<{
        ok: boolean;
        character: Character;
      }>("/api/characters", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
  
      setCharacters((prev) => [...prev, res.character]);
      setNewCharName("");
  
      if (!selectedCharId) {
        setSelectedCharId(res.character.id);
      }
    } catch (err: any) {
      console.error("[createCharacter] error", err);
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!token || !selectedCharId) {
      setSelectedCharState(null);
      return;
    }
  
    (async () => {
      try {
        const res = await api<{ ok: boolean; character: CharacterState }>(
          `/api/characters/${selectedCharId}`,
          { headers: authedHeaders }
        );
        setSelectedCharState(res.character);
      } catch (e: any) {
        setSelectedCharState(null);
        appendLog(`[web] failed to fetch character state: ${e.message ?? String(e)}`);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, selectedCharId]);

  // ---------------------------------------------------------------------------
  // Shard WebSocket
  // ---------------------------------------------------------------------------

  function connectToShard() {
    if (!token) {
      setError("You must be logged in to connect to the shard.");
      return;
    }
    if (!selectedCharId) {
      setError("Select a character first.");
      return;
    }

    if (ws) {
      ws.close();
      setWs(null);
      setWsStatus("disconnected");
      setWsLog([]);
    }

    const url = new URL(SHARD_WS);
    url.searchParams.set("token", token);
    url.searchParams.set("characterId", selectedCharId);

    const socket = new WebSocket(url.toString());

    setWsStatus("connecting");
    setWsLog((prev) => [
      ...prev,
      `Connecting to shard as character ${selectedCharId}...`,
    ]);

    socket.onopen = () => {
      setWsStatus("connected");
      setWsLog((prev) => [...prev, "WebSocket connected."]);
    };

    socket.onmessage = (event) => {
      console.log("WS IN:", event.data);
      try {
        const msg = JSON.parse(event.data);
    
        switch (msg.op) {
          case "whereami_result": {
            const p = msg.payload;
            appendLog(
              `← whereami_result: shard=${p.shardId}, room=${p.roomId}, ` +
              `pos=(${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}), ` +
              `region=${p.regionId ?? "none"}`
            );
            break;
          }
    
          case "mud_result": {
            appendLog(`[world]\n${msg.payload.text}`);
            break;
          }
    
          case "chat": {
            appendLog(
              `[chat] ${msg.payload.from}: ${msg.payload.text}`
            );
            break;
          }
    
          default:
            appendLog("← " + event.data);
        }
      } catch {
        appendLog("← " + event.data);
      }
    };

    socket.onclose = (event) => {
      setWsStatus("disconnected");
      setWsLog((prev) => [
        ...prev,
        `WebSocket closed (code=${event.code}, reason=${
          event.reason || "n/a"
        })`,
      ]);
      setWs(null);
    };

    socket.onerror = (event) => {
      setWsLog((prev) => [...prev, `WebSocket error: ${String(event)}`]);
    };

    setWs(socket);
  }

  function disconnectFromShard() {
    if (ws) {
      setWsLog((prev) => [...prev, "Disconnect requested."]);
      ws.close(); // onclose handler will clean up status + ws
    }
  }

  function sendShardMessage(msg: any) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      appendLog("WS not connected.");
      return;
    }
    ws.send(JSON.stringify(msg));
  }

  function requestWhereAmI() {
    sendShardMessage({
      op: "whereami",
      payload: {},
    });
    appendLog("→ whereami");
  }

  // ---------------------------------------------------------------------------

  return (
    <div
      style={{
        fontFamily: "system-ui, sans-serif",
        padding: "1.5rem",
        maxWidth: 1000,
        margin: "0 auto",
      }}
    >
      <h1>Planar War – Web Console</h1>

      {/* AUTH SECTION */}
      <section
        style={{
          border: "1px solid #444",
          borderRadius: 8,
          padding: 16,
          marginTop: 12,
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
          <strong>Auth</strong>
          <div>
            <button
              type="button"
              onClick={() => setAuthMode("login")}
              disabled={authMode === "login"}
              style={{ marginRight: 4 }}
            >
              Login
            </button>
            <button
              type="button"
              onClick={() => setAuthMode("register")}
              disabled={authMode === "register"}
            >
              Register
            </button>
          </div>
        </header>

        {account && (
          <div style={{ marginBottom: 8 }}>
            Logged in as <strong>{account.displayName}</strong>{" "}
            <button type="button" onClick={logout} style={{ marginLeft: 8 }}>
              Logout
            </button>
          </div>
        )}

        {!account && (
          <form onSubmit={handleAuthSubmit}>
            <div style={{ marginBottom: 8 }}>
              <label>
                Email{" "}
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </label>
            </div>

            {authMode === "register" && (
              <div style={{ marginBottom: 8 }}>
                <label>
                  Display name{" "}
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
        )}

        {error && (
          <p style={{ color: "red", marginTop: 8 }}>Error: {error}</p>
        )}

        {busy && <p style={{ marginTop: 8 }}>Working...</p>}
      </section>

      {/* CHARACTERS SECTION */}
      {account && (
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
          <div style={{ marginTop: 12, padding: 12, border: "1px solid #333", borderRadius: 8 }}>
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
                    <strong>{c.name}</strong> — {c.classId} (lvl {c.level}) on{" "}
                    {c.shardId}
                  </label>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* SHARD CONNECTION SECTION */}
      {account && (
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
            <button
              disabled={wsStatus !== "connected"}
              onClick={requestWhereAmI}
            >
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
            onKeyDown={e => {
              if (e.key !== "Enter") return;

              const value = (e.target as HTMLInputElement).value.trim();
              if (!value) return;

              (e.target as HTMLInputElement).value = "";

              ws?.send(JSON.stringify({
                op: "mud",
                payload: { text: value }
              }));

              appendLog(`> ${value}`);
            }}
          />
          <div
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
              <div style={{ opacity: 0.7 }}>
                WebSocket log will appear here…
              </div>
            ) : (
              wsLog.map((line, idx) => <div key={idx}>{line}</div>)
            )}
          </div>
        </section>
      )}
    </div>
  );
}

export default App;
