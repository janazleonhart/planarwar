// web-frontend/pages/ModeHubPage.tsx

import * as React from "react";

export type AppModeId = "mud" | "city" | "admin";

export type ModeCard = {
  id: AppModeId;
  title: string;
  description: string;
  path: string;
  enabled: boolean;
};

function Card(props: {
  title: string;
  description: string;
  enabled: boolean;
  onClick: () => void;
}) {
  const { title, description, enabled, onClick } = props;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!enabled}
      style={{
        textAlign: "left",
        border: "1px solid #444",
        borderRadius: 12,
        padding: 16,
        background: enabled ? "#151515" : "#0f0f0f",
        color: enabled ? "#eee" : "#888",
        cursor: enabled ? "pointer" : "not-allowed",
        boxShadow: "0 1px 0 rgba(255,255,255,0.03) inset",
      }}
    >
      <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 6 }}>
        {title} {!enabled && <span style={{ fontWeight: 700, opacity: 0.7 }}>(disabled)</span>}
      </div>
      <div style={{ fontSize: 13, lineHeight: 1.35, opacity: 0.9 }}>{description}</div>
    </button>
  );
}

export function ModeHubPage(props: {
  cards: ModeCard[];
  onPick: (mode: AppModeId) => void;
}) {
  const { cards, onPick } = props;

  return (
    <section style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "grid", gap: 6 }}>
        <h2 style={{ margin: 0 }}>Choose a mode</h2>
        <div style={{ fontSize: 13, opacity: 0.85 }}>
          Same account. Same world. Different interfaces. The multiverse is messy like that.
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: 12,
        }}
      >
        {cards.map((c) => (
          <Card
            key={c.id}
            title={c.title}
            description={c.description}
            enabled={c.enabled}
            onClick={() => onPick(c.id)}
          />
        ))}
      </div>

      <div style={{ fontSize: 12, opacity: 0.75 }}>
        Tip: add <code>?hub=1</code> to the URL to force this page even if “auto-resume” is enabled.
      </div>
    </section>
  );
}
