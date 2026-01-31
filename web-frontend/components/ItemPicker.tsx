// web-frontend/components/ItemPicker.tsx

import { useEffect, useMemo, useRef, useState } from "react";
import { getAuthToken } from "../lib/api";

export type ItemOption = {
  id: string;
  name: string;
  rarity?: string;
  iconId?: string;
  label: string;
};

type Props = {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  placeholder?: string;
  style?: React.CSSProperties;
  listId?: string;
  // Called when the current value is known to exist in DB.
  onResolved?: (opt: ItemOption | null) => void;
};

const authedFetch: typeof fetch = (input: any, init?: any) => {
  const token = getAuthToken();
  const headers = new Headers(init?.headers ?? {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...(init ?? {}), headers });
};

// Tiny module-level cache so multiple pickers don't spam /options.
const optionCache = new Map<string, ItemOption>();

function normalizeId(s: string): string {
  return String(s ?? "").trim();
}

export function ItemPicker(props: Props) {
  const {
    value,
    onChange,
    disabled,
    placeholder = "item_id",
    style,
    listId = "itempicker-options",
    onResolved,
  } = props;

  const [options, setOptions] = useState<ItemOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const v = normalizeId(value);

  // Track the latest request to avoid races.
  const reqIdRef = useRef(0);

  const resolved = useMemo(() => {
    if (!v) return null;
    return optionCache.get(v) ?? null;
  }, [v, options]);

  useEffect(() => {
    onResolved?.(resolved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolved?.id]);

  useEffect(() => {
    // If empty, don't fetch.
    if (!v) {
      setOptions([]);
      setError(null);
      setLoading(false);
      return;
    }

    // Debounce a bit.
    const t = setTimeout(async () => {
      const myId = ++reqIdRef.current;
      setLoading(true);
      setError(null);
      try {
        const q = encodeURIComponent(v);
        const res = await authedFetch(`/api/admin/items/options?q=${q}&limit=50`);
        const data: { ok: boolean; items: ItemOption[]; error?: string } = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
        if (myId !== reqIdRef.current) return; // out of date

        const next = (data.items ?? []).map((x: any) => {
          const opt: ItemOption = {
            id: String(x.id),
            name: String(x.name ?? ""),
            rarity: x.rarity ? String(x.rarity) : "",
            iconId: x.iconId ? String(x.iconId) : "",
            label: String(x.label ?? x.id),
          };
          optionCache.set(opt.id, opt);
          return opt;
        });

        setOptions(next);
      } catch (e: any) {
        if (myId !== reqIdRef.current) return;
        setError(e?.message || String(e));
        setOptions([]);
      } finally {
        if (myId === reqIdRef.current) setLoading(false);
      }
    }, 180);

    return () => clearTimeout(t);
  }, [v]);

  const exists = Boolean(v && resolved);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      <input
        list={listId}
        placeholder={placeholder}
        style={{ minWidth: 160, ...(style ?? {}) }}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      />

      <datalist id={listId}>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </datalist>

      {loading && <span style={{ fontSize: 11, opacity: 0.7 }}>…</span>}

      {v && exists && (
        <span style={{ fontSize: 12, opacity: 0.85, whiteSpace: "nowrap" }}>
          {resolved?.name ? (
            <>
              {resolved.name} <code>({resolved.id})</code>
            </>
          ) : (
            <code>({resolved?.id})</code>
          )}
        </span>
      )}

      {v && !exists && !loading && (
        <span style={{ fontSize: 12, color: "#b00020", whiteSpace: "nowrap" }} title={error ?? ""}>
          unknown item
        </span>
      )}

      {error && (
        <span style={{ fontSize: 11, color: "#b00020", opacity: 0.9 }} title={error}>
          !
        </span>
      )}
    </div>
  );
}
