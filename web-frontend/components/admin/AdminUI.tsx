// web-frontend/components/admin/AdminUI.tsx
//
// Tiny admin UI kit (no dependency on Tailwind/shadcn).
// Goal: make all admin editors readable + consistent without rewriting logic.
//
// Usage:
//   <AdminShell title="Items" subtitle="...">
//     <AdminTwoCol left={<AdminPanel ... />} right={<AdminPanel ... />} />
//   </AdminShell>

import * as React from "react";

export const ADMIN_UI_CSS = `
.pw-admin {
  --pw-bg: #ffffff;
  --pw-panel: #ffffff;
  --pw-border: #d8d8d8;
  --pw-text: #111111;
  --pw-subtle: rgba(0,0,0,0.65);
  --pw-input-bg: #ffffff;
  --pw-input-border: #c9c9c9;
  --pw-focus: #2a5bd7;
  --pw-btn-bg: #f3f3f3;
  --pw-btn-border: #d0d0d0;
  --pw-btn-text: #111111;
  --pw-btn-primary-bg: #2a5bd7;
  --pw-btn-primary-border: #2a5bd7;
  --pw-btn-primary-text: #ffffff;
  --pw-error-bg: #ffe7e7;
  --pw-error-border: #d25555;
  --pw-warn-bg: #fff6db;
  --pw-warn-border: #e3c45c;
}

/* Make legacy pages instantly readable (override inline dark styles where possible). */
.pw-admin,
.pw-admin * {
  box-sizing: border-box;
}

/* Inputs */
.pw-admin input,
.pw-admin textarea,
.pw-admin select {
  background: var(--pw-input-bg) !important;
  color: var(--pw-text) !important;
  border: 1px solid var(--pw-input-border) !important;
  border-radius: 10px !important;
  padding: 8px 10px !important;
  outline: none !important;
  font-size: 13px !important;
}

/* Buttons */
.pw-admin button {
  border-radius: 999px !important;
  border: 1px solid var(--pw-btn-border) !important;
  background: var(--pw-btn-bg) !important;
  color: var(--pw-btn-text) !important;
  padding: 8px 12px !important;
  font-size: 12px !important;
  font-weight: 800 !important;
}

.pw-admin button[data-kind="primary"] {
  background: var(--pw-btn-primary-bg) !important;
  border-color: var(--pw-btn-primary-border) !important;
  color: var(--pw-btn-primary-text) !important;
}

.pw-admin button[data-kind="danger"] {
  background: #d25555 !important;
  border-color: #d25555 !important;
  color: #ffffff !important;
}

/* Panels */
.pw-admin .pw-panel {
  border: 1px solid var(--pw-border) !important;
  border-radius: 14px !important;
  background: var(--pw-panel) !important;
  padding: 12px !important;
}

/* List item cards */
.pw-admin .pw-card {
  border: 1px solid var(--pw-border) !important;
  border-radius: 12px !important;
  background: #fafafa !important;
  padding: 10px !important;
}

.pw-admin .pw-card[data-active="true"] {
  border-color: var(--pw-focus) !important;
  background: #eef4ff !important;
}

/* Kill harsh dark bars from old editors */
.pw-admin [style*="background: #111"],
.pw-admin [style*='background:"#111"'],
.pw-admin [style*="background: #151515"],
.pw-admin [style*='background:"#151515"'],
.pw-admin [style*="background: #101010"],
.pw-admin [style*='background:"#101010"'],
.pw-admin [style*="background: #000"],
.pw-admin [style*='background:"#000"'] {
  background: #ffffff !important;
  color: var(--pw-text) !important;
  border-color: var(--pw-border) !important;
}

/* Make headings sane */
.pw-admin h1, .pw-admin h2, .pw-admin h3 {
  color: var(--pw-text) !important;
}
`;

export function AdminShell(props: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { title, subtitle, actions, children } = props;
  return (
    <section className="pw-admin" style={{ background: "#ffffff", color: "#111111", padding: 12 }}>
      <style>{ADMIN_UI_CSS}</style>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <div style={{ display: "grid", gap: 4 }}>
          <h2 style={{ margin: 0 }}>{title}</h2>
          {subtitle ? <div style={{ fontSize: 12, color: "rgba(0,0,0,0.65)" }}>{subtitle}</div> : null}
        </div>

        {actions ? <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>{actions}</div> : null}
      </div>

      {children}
    </section>
  );
}

export function AdminTwoCol(props: { left: React.ReactNode; right: React.ReactNode; leftWidth?: number }) {
  const w = props.leftWidth ?? 360;
  return (
    <div style={{ display: "grid", gridTemplateColumns: `${w}px 1fr`, gap: 12, alignItems: "start" }}>
      <div>{props.left}</div>
      <div>{props.right}</div>
    </div>
  );
}

export function AdminPanel(props: { title?: string; subtitle?: string; children: React.ReactNode }) {
  const { title, subtitle, children } = props;
  return (
    <div className="pw-panel">
      {title ? (
        <div style={{ display: "grid", gap: 4, marginBottom: 10 }}>
          <div style={{ fontSize: 14, fontWeight: 900 }}>{title}</div>
          {subtitle ? <div style={{ fontSize: 12, color: "rgba(0,0,0,0.65)" }}>{subtitle}</div> : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}

export function AdminNotice(props: { kind: "error" | "warn"; children: React.ReactNode }) {
  const bg = props.kind === "error" ? "var(--pw-error-bg)" : "var(--pw-warn-bg)";
  const border = props.kind === "error" ? "var(--pw-error-border)" : "var(--pw-warn-border)";
  const text = props.kind === "error" ? "#7a1010" : "#7a5a00";
  return (
    <div style={{ border: `1px solid ${border}`, background: bg, padding: 10, borderRadius: 12, color: text, marginBottom: 12 }}>
      {props.children}
    </div>
  );
}

export function AdminButton(props: { kind?: "default" | "primary" | "danger"; disabled?: boolean; onClick?: () => void; children: React.ReactNode }) {
  const { kind = "default", disabled, onClick, children } = props;
  return (
    <button type="button" data-kind={kind} disabled={disabled} onClick={onClick} style={{ opacity: disabled ? 0.6 : 1, cursor: disabled ? "not-allowed" : "pointer" }}>
      {children}
    </button>
  );
}

export function AdminFieldLabel(props: { label: string; hint?: string }) {
  return (
    <div style={{ display: "grid", gap: 4, marginBottom: 4 }}>
      <div style={{ fontSize: 12, fontWeight: 900 }}>{props.label}</div>
      {props.hint ? <div style={{ fontSize: 11, color: "rgba(0,0,0,0.65)" }}>{props.hint}</div> : null}
    </div>
  );
}

export function AdminListItem(props: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button type="button" className="pw-card" data-active={props.active ? "true" : "false"} onClick={props.onClick} style={{ textAlign: "left", width: "100%" }}>
      <div style={{ fontWeight: 900, fontSize: 13 }}>{props.title}</div>
      {props.subtitle ? <div style={{ fontSize: 12, color: "rgba(0,0,0,0.65)", marginTop: 2 }}>{props.subtitle}</div> : null}
    </button>
  );
}
