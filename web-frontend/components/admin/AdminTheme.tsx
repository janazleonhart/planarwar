// web-frontend/components/admin/AdminTheme.tsx
// Safe, scoped admin styling: improves readability without restructuring pages.
// Applies only inside <div className="pw-admin">.

import * as React from "react";

const css = `
.pw-admin {
  background: #ffffff;
  color: #111111;
}

.pw-admin h1, .pw-admin h2, .pw-admin h3, .pw-admin h4 {
  color: #111111;
}

.pw-admin p, .pw-admin li, .pw-admin label, .pw-admin span {
  color: rgba(0,0,0,0.80);
}

.pw-admin code {
  color: #111111;
  background: #f3f3f3;
  border: 1px solid #e3e3e3;
  padding: 0 6px;
  border-radius: 8px;
}

.pw-admin input, .pw-admin textarea, .pw-admin select {
  box-sizing: border-box !important;
  width: 100%;
  border-radius: 10px !important;
  border: 1px solid #c9c9c9 !important;
  background: #ffffff !important;
  color: #111111 !important;
  padding: 8px 10px !important;
  outline: none !important;
}

.pw-admin input:focus, .pw-admin textarea:focus, .pw-admin select:focus {
  border-color: #2a5bd7 !important;
  box-shadow: 0 0 0 2px rgba(42,91,215,0.18) !important;
}

.pw-admin button {
  border-radius: 999px !important;
  border: 1px solid #d0d0d0 !important;
  background: #f3f3f3 !important;
  color: #111111 !important;
  padding: 8px 12px !important;
  font-weight: 800 !important;
  cursor: pointer !important;
}

.pw-admin button:hover {
  filter: brightness(0.98);
}

.pw-admin button:disabled {
  opacity: 0.6;
  cursor: default;
}
`;

export function AdminTheme() {
  return <style>{css}</style>;
}
