// web-frontend/pages/AdminHubPage.tsx

import * as React from "react";

type LinkCard = {
  title: string;
  path: string;
  description: string;
};

function Card(props: { item: LinkCard; onGo: (path: string) => void }) {
  const { item, onGo } = props;

  return (
    <button
      type="button"
      onClick={() => onGo(item.path)}
      style={{
        textAlign: "left",
        border: "1px solid #444",
        borderRadius: 12,
        padding: 14,
        background: "#151515",
        color: "#eee",
        cursor: "pointer",
        boxShadow: "0 1px 0 rgba(255,255,255,0.03) inset",
      }}
    >
      <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 6 }}>{item.title}</div>
      <div style={{ fontSize: 12, opacity: 0.85 }}>{item.description}</div>
      <div style={{ fontSize: 12, opacity: 0.75, marginTop: 8 }}>
        <code>{item.path}</code>
      </div>
    </button>
  );
}

export function AdminHubPage(props: { onGo: (path: string) => void; role?: string }) {
  const links: LinkCard[] = [
    {
      title: "Spawn Points Editor",
      path: "/admin/spawn_points",
      description:
        "Seed/anchor placement editor + Mother Brain wave/wipe tools + town baseline tooling.",
    },
    {
      title: "Quests",
      path: "/admin/quests",
      description: "Quest list + create/edit + objectives.",
    },
    {
      title: "NPCs",
      path: "/admin/npcs",
      description: "NPC prototypes + loot editor + vendor-tag toggle (when enabled).",
    },
    {
      title: "Items",
      path: "/admin/items",
      description: "Item prototypes + stats/flags text editing.",
    },
    {
      title: "Vendor Economy",
      path: "/admin/vendor_economy",
      description: "View and tune vendor pricing/restock knobs (tier policy + overrides).",
    },
    {
      title: "Vendor Audit",
      path: "/admin/vendor_audit",
      description: "Query + export vendor_log events for buy/sell auditing.",
    },
  ];

  return (
    <section style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "grid", gap: 6 }}>
        <h2 style={{ margin: 0 }}>
          Admin tools{" "}
          {props.role ? (
            <span style={{ fontSize: 12, opacity: 0.8, marginLeft: 8 }}>
              <code>role:{props.role}</code>
            </span>
          ) : null}
        </h2>
        <div style={{ fontSize: 13, opacity: 0.85 }}>
          Because memorizing URLs is a crime against both ergonomics and sanity.
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: 12,
        }}
      >
        {links.map((l) => (
          <Card key={l.path} item={l} onGo={props.onGo} />
        ))}
      </div>

      <div style={{ fontSize: 12, opacity: 0.75 }}>
        Note: The UI link is just a shortcut — real enforcement happens on the server via{" "}
        <code>/api/admin/*</code> auth. This hub is now hidden for non-admin accounts.
      </div>
    </section>
  );
}
