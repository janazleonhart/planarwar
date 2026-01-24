// web-frontend/pages/CityShellPage.tsx

import React, { useEffect, useMemo, useState } from "react";
import { MePage } from "./MePage";
import { OperationsPage } from "./OperationsPage";

type CityTabId = "me" | "operations";

function getCityTabFromPathname(pathname: string): CityTabId {
  if (pathname.endsWith("/operations")) return "operations";
  return "me";
}

function getCityPathForTab(tab: CityTabId): string {
  return tab === "operations" ? "/city/operations" : "/city/me";
}

class LocalErrorBoundary extends React.Component<
  { title: string; children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[CityBuilder:${this.props.title}]`, error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <section style={{ padding: 16 }}>
          <h2 style={{ marginTop: 0 }}>{this.props.title}</h2>
          <p style={{ color: "salmon", marginTop: 8 }}>
            CityBuilder crashed inside this panel (but the app survived). Entropy detected.
          </p>
          <pre
            style={{
              whiteSpace: "pre-wrap",
              background: "#111",
              color: "#ddd",
              border: "1px solid #444",
              borderRadius: 8,
              padding: 12,
              overflowX: "auto",
            }}
          >
            {String(this.state.error?.message ?? this.state.error)}
          </pre>
          <button
            style={{
              marginTop: 12,
              padding: "6px 10px",
              borderRadius: 6,
              border: "1px solid #777",
              background: "#111",
              cursor: "pointer",
            }}
            onClick={() => this.setState({ error: null })}
          >
            Reset panel
          </button>
        </section>
      );
    }

    return this.props.children;
  }
}

export function CityShellPage(props: { path: string; onGo: (path: string) => void }) {
  const { path, onGo } = props;

  // Seed tab from the path App gives us (NOT window), so TS+router stay aligned.
  const initialTab = useMemo(() => getCityTabFromPathname(path || "/city/me"), []);
  const [tab, setTab] = useState<CityTabId>(initialTab);

  // Keep tab synced with the current path (App navigation).
  useEffect(() => {
    const next = getCityTabFromPathname(path || "/city/me");
    setTab((prev) => (prev === next ? prev : next));
  }, [path]);

  // Still listen to back/forward as a belt-and-suspenders fallback
  // (in case App stops passing a new `path` for some reason).
  useEffect(() => {
    const onPop = () => {
      const next = getCityTabFromPathname(window.location.pathname || "/city/me");
      setTab((prev) => (prev === next ? prev : next));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const content = tab === "operations" ? <OperationsPage /> : <MePage />;

  return (
    <section style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <h2 style={{ margin: 0 }}>City Builder</h2>
        <span style={{ opacity: 0.75, fontSize: 13 }}>
          Early demo UI. Still sharp around the edges. (So are most realities.)
        </span>
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
        <button
          style={{
            padding: "6px 10px",
            borderRadius: 999,
            border: "1px solid #777",
            background: tab === "me" ? "#111" : "#fff",
            color: tab === "me" ? "#fff" : "#111",
            cursor: "pointer",
            fontWeight: tab === "me" ? 700 : 500,
          }}
          onClick={() => {
            setTab("me");
            onGo(getCityPathForTab("me"));
          }}
        >
          City
        </button>

        <button
          style={{
            padding: "6px 10px",
            borderRadius: 999,
            border: "1px solid #777",
            background: tab === "operations" ? "#111" : "#fff",
            color: tab === "operations" ? "#fff" : "#111",
            cursor: "pointer",
            fontWeight: tab === "operations" ? 700 : 500,
          }}
          onClick={() => {
            setTab("operations");
            onGo(getCityPathForTab("operations"));
          }}
        >
          Operations
        </button>
      </div>

      <div
        style={{
          marginTop: 12,
          border: "1px solid #444",
          borderRadius: 10,
          padding: 12,
        }}
      >
        {/* key=tab ensures each panel remounts cleanly if it ever gets cursed */}
        <LocalErrorBoundary title={`CityBuilder /${tab}`}>
          <div key={tab}>{content}</div>
        </LocalErrorBoundary>
      </div>
    </section>
  );
}
