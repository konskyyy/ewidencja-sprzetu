import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { API_BASE, getToken, loginRequest, meRequest, setToken } from "./api";

import "leaflet/dist/leaflet.css";
import "leaflet-draw/dist/leaflet.draw.css";

import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  useMapEvents,
  useMap,
  ZoomControl,
  GeoJSON,
  FeatureGroup,
  Polyline,
  Tooltip,
} from "react-leaflet";

import L from "leaflet";

/** ===== API ===== */
const API = API_BASE.endsWith("/api") ? API_BASE : `${API_BASE}/api`;

/** ===== UI CONSTS ===== */
const TEXT_LIGHT = "#ffffff";
const BORDER = "rgba(255,255,255,0.12)";
const MUTED = "rgba(255,255,255,0.75)";

// glossy
const GLASS_BG = "rgba(22,42,64,0.70)";
const GLASS_BG_DARK = "rgba(22,42,64,0.90)";
const GLASS_SHADOW = "0 10px 28px rgba(0,0,0,0.35)";
const GLASS_HIGHLIGHT =
  "radial-gradient(700px 400px at 20% 10%, rgba(255,255,255,0.10), transparent 60%)";

/** ===== MAP CONSTS ===== */
const POLAND_BOUNDS = [
  [49.0, 14.1],
  [54.9, 24.2],
];

const STATUSES = [
  { key: "planowany", label: "Planowany", color: "#3b82f6" },
  { key: "przetarg", label: "Przetarg", color: "#f59e0b" },
  { key: "realizacja", label: "Realizacja", color: "#22c55e" },
  { key: "nieaktualny", label: "Nieaktualny", color: "#9ca3af" },
];

// Natural Earth (GeoJSON) – granice państw
const NE_COUNTRIES_URL =
  "https://d2ad6b4ur7yvpq.cloudfront.net/naturalearth-3.3.0/ne_50m_admin_0_countries.geojson";
const KEEP_COUNTRIES_A3 = new Set(["POL", "LTU", "LVA", "EST"]);

function ClickHandler({ enabled, onAdd }) {
  useMapEvents({
    click(e) {
      if (!enabled) return;
      onAdd(e.latlng);
    },
  });
  return null;
}

function statusLabel(s) {
  if (s === "przetarg") return "przetarg";
  if (s === "realizacja") return "realizacja";
  if (s === "nieaktualny") return "nieaktualny";
  return "planowany";
}

function statusColor(status) {
  if (status === "przetarg") return "#f59e0b";
  if (status === "realizacja") return "#22c55e";
  if (status === "nieaktualny") return "#9ca3af";
  return "#3b82f6";
}

function tunnelColor(status) {
  return statusColor(status);
}

function pinSvg(color) {
  return `
  <svg width="34" height="34" viewBox="0 0 24 24" fill="none"
       xmlns="http://www.w3.org/2000/svg">
    <path d="M12 22s7-6.1 7-12a7 7 0 1 0-14 0c0 5.9 7 12 7 12Z"
          fill="${color}"/>
    <circle cx="12" cy="10" r="2.6" fill="white" fill-opacity="0.95"/>
    <circle cx="12" cy="10" r="1.4" fill="rgba(0,0,0,0.25)"/>
  </svg>`;
}

function makePinIcon(color) {
  return L.divIcon({
    className: "",
    html: pinSvg(color),
    iconSize: [34, 34],
    iconAnchor: [17, 32],
    popupAnchor: [0, -28],
  });
}

function extractOuterRings(geometry) {
  if (!geometry) return [];
  const { type, coordinates } = geometry;

  if (type === "Polygon") {
    return coordinates?.[0] ? [coordinates[0]] : [];
  }
  if (type === "MultiPolygon") {
    const rings = [];
    for (const poly of coordinates || []) {
      if (poly?.[0]) rings.push(poly[0]);
    }
    return rings;
  }
  return [];
}

/** ===== helper: JSON-safe ===== */
async function readJsonOrThrow(res) {
  const text = await res.text();

  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    const head = (text || "").slice(0, 160).replace(/\s+/g, " ");
    const err = new Error(
      `API nie zwróciło JSON (HTTP ${res.status}). Początek: ${head || "(pusto)"}`
    );
    err.status = res.status;
    throw err;
  }

  if (!res.ok) {
    const err = new Error(data?.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }

  return data;
}

function toPath(latlngs) {
  const arr = Array.isArray(latlngs) ? latlngs : [];
  return arr.map((p) => ({ lat: Number(p.lat), lng: Number(p.lng) }));
}

function MapRefSetter({ onReady }) {
  const map = useMap();

  useEffect(() => {
    onReady?.(map);
  }, [map, onReady]);

  return null;
}

function formatDateTimePL(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("pl-PL", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return String(iso);
  }
}

/** ===== CHANCE RING ===== */
function ringColor(pct) {
  const v = Math.max(0, Math.min(100, Number(pct) || 0));
  if (v >= 80) return "rgba(34,197,94,0.95)"; // zielony
  if (v >= 60) return "rgba(245,158,11,0.95)"; // żółty
  return "rgba(239,68,68,0.95)"; // czerwony
}

function ChanceRing({ value = 50, size = 44, tooltip = "" }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  const stroke = 5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = (v / 100) * c;
  const col = ringColor(v);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 4,
        flexShrink: 0,
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 800,
          color: "rgba(255,255,255,0.65)",
          letterSpacing: 0.2,
        }}
      >
        Szansa
      </div>

      <div
        title={tooltip || undefined}
        style={{
          width: size,
          height: size,
          position: "relative",
          cursor: tooltip ? "help" : "default",
        }}
      >
        <svg width={size} height={size}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke="rgba(255,255,255,0.18)"
            strokeWidth={stroke}
            fill="transparent"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={col}
            strokeWidth={stroke}
            fill="transparent"
            strokeLinecap="round"
            strokeDasharray={`${dash} ${c - dash}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        </svg>

        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            fontWeight: 900,
            fontSize: 12,
            color: "rgba(255,255,255,0.92)",
            pointerEvents: "none",
          }}
        >
          {v}%
        </div>
      </div>
    </div>
  );
}

function chanceFromJournalCount(count) {
  const n = Math.max(0, Number(count) || 0);
  // 0 wpisów = 50%, 1=60, 2=70, 3=80, 4+=90
  return Math.min(90, 50 + Math.min(4, n) * 10);
}

function projectChance({ acquired, journalCount }) {
  if (acquired) return 100;
  return chanceFromJournalCount(journalCount);
}

/** ===== JOURNAL ===== */
function JournalPanel({
  visible,
  kind, // "points" | "tunnels"
  entity, // selectedPoint | selectedTunnel
  user,
  authFetch,
  API,
  BORDER,
  MUTED,
  TEXT_LIGHT,
  GLASS_BG,
  GLASS_SHADOW,
  onCountsChange,
  onUnauthorized,
  onGlobalUpdatesChange, // trigger refresh of updates feed
}) {
  const entityId = entity?.id ?? null;

  const [open, setOpen] = useState(true);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [items, setItems] = useState([]);
  const [draft, setDraft] = useState("");

  const [editingId, setEditingId] = useState(null);
  const [editingBody, setEditingBody] = useState("");
  const [busyActionId, setBusyActionId] = useState(null);

  // ===== open state per entity (localStorage) =====
  const openKey = entityId ? `journalOpen:${kind}:${entityId}` : null;

  function readOpenFromStorage() {
    if (!openKey) return true;
    try {
      const raw = localStorage.getItem(openKey);
      if (raw === null) return true; // domyślnie otwarte
      return JSON.parse(raw) === true;
    } catch {
      return true;
    }
  }

  function saveOpenToStorage(nextOpen) {
    if (!openKey) return;
    try {
      localStorage.setItem(openKey, JSON.stringify(!!nextOpen));
    } catch {}
  }

  function isWithinDays(iso, days = 14) {
    if (!iso) return false;
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return false;
    const now = Date.now();
    const ms = days * 24 * 60 * 60 * 1000;
    return now - t <= ms;
  }

  const recentItems = useMemo(() => {
    const arr = Array.isArray(items) ? items : [];
    return arr.filter((c) => isWithinDays(c.created_at, 14));
  }, [items]);

  async function load() {
    if (!entityId) return;
    setLoading(true);
    setErr("");
    try {
      const res = await authFetch(`${API}/${kind}/${entityId}/comments`);
      const data = await readJsonOrThrow(res);
      const next = Array.isArray(data) ? data : [];
      setItems(next);
      onCountsChange?.(kind, entityId, next.length);
    } catch (e) {
      if (e?.status === 401) return onUnauthorized?.();
      setErr(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!visible) return;
    setOpen(readOpenFromStorage());
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, kind, entityId]);

  async function addComment() {
    if (!entityId) return;
    const body = String(draft || "").trim();
    if (!body) return;

    setBusyActionId("add");
    setErr("");
    try {
      const res = await authFetch(`${API}/${kind}/${entityId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const created = await readJsonOrThrow(res);
      setDraft("");

      setItems((prev) => {
        const next = [created, ...(Array.isArray(prev) ? prev : [])];
        onCountsChange?.(kind, entityId, next.length);
        return next;
      });

      onGlobalUpdatesChange?.();
    } catch (e) {
      if (e?.status === 401) return onUnauthorized?.();
      setErr(String(e?.message || e));
    } finally {
      setBusyActionId(null);
    }
  }

  async function saveEdit(commentId) {
    if (!entityId) return;
    const body = String(editingBody || "").trim();
    if (!body) return;

    setBusyActionId(commentId);
    setErr("");
    try {
      const res = await authFetch(`${API}/${kind}/${entityId}/comments/${commentId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const updated = await readJsonOrThrow(res);

      setItems((prev) =>
        (Array.isArray(prev) ? prev : []).map((x) =>
          String(x.id) === String(updated.id) ? updated : x
        )
      );

      setEditingId(null);
      setEditingBody("");

      onGlobalUpdatesChange?.();
    } catch (e) {
      if (e?.status === 401) return onUnauthorized?.();
      setErr(String(e?.message || e));
    } finally {
      setBusyActionId(null);
    }
  }

  async function removeComment(commentId) {
    if (!entityId) return;
    const ok = window.confirm("Usunąć ten wpis z dziennika?");
    if (!ok) return;

    setBusyActionId(commentId);
    setErr("");
    try {
      const res = await authFetch(`${API}/${kind}/${entityId}/comments/${commentId}`, {
        method: "DELETE",
      });
      await readJsonOrThrow(res);

      setItems((prev) => {
        const next = (Array.isArray(prev) ? prev : []).filter(
          (x) => String(x.id) !== String(commentId)
        );
        onCountsChange?.(kind, entityId, next.length);
        return next;
      });

      if (String(editingId) === String(commentId)) {
        setEditingId(null);
        setEditingBody("");
      }

      onGlobalUpdatesChange?.();
    } catch (e) {
      if (e?.status === 401) return onUnauthorized?.();
      setErr(String(e?.message || e));
    } finally {
      setBusyActionId(null);
    }
  }

  if (!visible) return null;

  const title =
    kind === "points"
      ? `Dziennik: ${entity?.title || `#${entityId}`}`
      : `Dziennik: ${entity?.name || `#${entityId}`}`;

  const headerBoxStyle = {
    padding: "10px 12px",
    cursor: "pointer",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    fontWeight: 900,
    background: "rgba(0,0,0,0.10)",
  };

  const sectionTitleStyle = {
    fontSize: 12,
    fontWeight: 900,
    color: "rgba(255,255,255,0.88)",
    letterSpacing: 0.2,
  };

  const sectionHintStyle = {
    fontSize: 12,
    color: MUTED,
    opacity: 0.9,
    marginTop: 2,
  };

  const listWrapStyle = {
    display: "grid",
    gap: 10,
    overflow: "auto",
    paddingRight: 4,
  };

  const cardItemStyle = {
    borderRadius: 14,
    border: `1px solid ${BORDER}`,
    background: "rgba(255,255,255,0.06)",
    padding: 10,
    display: "grid",
    gap: 8,
  };

  const metaStyle = { fontSize: 11, color: MUTED };

  const bodyTextStyle = {
    whiteSpace: "pre-wrap",
    fontSize: 13,
    lineHeight: 1.45,
    color: "rgba(255,255,255,0.92)",
  };

  const smallBtnStyle = {
    padding: "6px 9px",
    borderRadius: 12,
    border: `1px solid ${BORDER}`,
    background: "rgba(255,255,255,0.08)",
    color: TEXT_LIGHT,
    cursor: "pointer",
    fontWeight: 900,
    fontSize: 11,
  };

  // wysokość scrolla dla „Wszystkie wpisy”
  const maxHeightAll = 170;

  return (
    <div
      style={{
        borderRadius: 16,
        border: `1px solid ${BORDER}`,
        background: GLASS_BG,
        backgroundImage:
          "radial-gradient(520px 320px at 20% 10%, rgba(255,255,255,0.10), transparent 60%)",
        color: TEXT_LIGHT,
        overflow: "hidden",
        boxShadow: GLASS_SHADOW,
        backdropFilter: "blur(8px)",
      }}
    >
      <div
        onClick={() => {
          setOpen((o) => {
            const next = !o;
            saveOpenToStorage(next);
            return next;
          });
        }}
        style={headerBoxStyle}
      >
        <span>{title}</span>
        <span style={{ fontSize: 12, color: MUTED }}>
          {loading ? "Ładuję..." : `${recentItems.length} wpis(y)`} {open ? "▾" : "▸"}
        </span>
      </div>

      {open ? (
        <div style={{ padding: "8px 10px 10px", display: "grid", gap: 10 }}>
          {err ? (
            <div
              style={{
                padding: 10,
                borderRadius: 14,
                border: "1px solid rgba(255,120,120,0.45)",
                background: "rgba(255,120,120,0.12)",
                color: "rgba(255,255,255,0.95)",
                fontSize: 12,
              }}
            >
              {err}
            </div>
          ) : null}

          {/* DODAWANIE */}
          <div style={{ display: "grid", gap: 8 }}>
            <textarea
              className="journalTextarea"
              rows={2}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Dodaj wpis do dziennika…"
              style={{
                padding: 8,
                borderRadius: 12,
                border: `1px solid ${BORDER}`,
                background: "rgba(255,255,255,0.08)",
                outline: "none",
                resize: "vertical",
              }}
            />

            <button
              onClick={addComment}
              disabled={busyActionId === "add" || !draft.trim()}
              style={{
                padding: "8px 10px",
                borderRadius: 12,
                border: `1px solid ${BORDER}`,
                background: "rgba(255,255,255,0.10)",
                color: TEXT_LIGHT,
                cursor: busyActionId === "add" || !draft.trim() ? "default" : "pointer",
                fontWeight: 900,
                fontSize: 12,
                width: "fit-content",
                justifySelf: "start",
              }}
            >
              {busyActionId === "add" ? "Dodaję..." : "Dodaj wpis"}
            </button>
          </div>

          <div style={{ height: 1, background: BORDER, opacity: 0.9 }} />

          {/* OSTATNIE 2 TYGODNIE */}
          <div style={{ display: "grid", gap: 8 }}>
            <div>
              <div style={sectionTitleStyle}>Ostatnie 2 tygodnie</div>
              <div style={sectionHintStyle}>Pokazuję aktywność z ostatnich 14 dni.</div>
            </div>

            {recentItems.length === 0 ? (
              <div
                style={{
                  padding: 10,
                  borderRadius: 14,
                  border: `1px solid ${BORDER}`,
                  background: "rgba(255,255,255,0.05)",
                  fontSize: 12,
                  color: MUTED,
                }}
              >
                Brak aktywności w ostatnim czasie dla tego projektu.
              </div>
            ) : (
              <div style={{ ...listWrapStyle, maxHeight: 160 }}>
                {recentItems.map((c) => {
                  const isMine = String(c.user_id) === String(user?.id);
                  const isEditing = String(editingId) === String(c.id);

                  return (
                    <div key={c.id} style={cardItemStyle}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                        <div style={metaStyle}>
                          <b style={{ color: "rgba(255,255,255,0.92)" }}>
                            {c.user_email || "użytkownik"}
                          </b>{" "}
                          • {formatDateTimePL(c.created_at)}
                          {c.edited ? (
                            <span style={{ marginLeft: 6, opacity: 0.8 }}>(edytowano)</span>
                          ) : null}
                        </div>

                        {isMine ? (
                          <div style={{ display: "flex", gap: 8 }}>
                            {!isEditing ? (
                              <button
                                onClick={() => {
                                  setEditingId(c.id);
                                  setEditingBody(c.body || "");
                                }}
                                style={smallBtnStyle}
                              >
                                Edytuj
                              </button>
                            ) : null}

                            <button
                              onClick={() => removeComment(c.id)}
                              disabled={busyActionId === c.id}
                              style={{
                                ...smallBtnStyle,
                                border: "1px solid rgba(255,80,80,0.55)",
                                background: "rgba(255,80,80,0.12)",
                              }}
                            >
                              {busyActionId === c.id ? "..." : "Usuń"}
                            </button>
                          </div>
                        ) : null}
                      </div>

                      {!isEditing ? (
                        <div style={bodyTextStyle}>{c.body}</div>
                      ) : (
                        <div style={{ display: "grid", gap: 8 }}>
                          <textarea
                            className="journalTextarea"
                            rows={2}
                            value={editingBody}
                            onChange={(e) => setEditingBody(e.target.value)}
                            style={{
                              padding: 8,
                              borderRadius: 12,
                              border: `1px solid ${BORDER}`,
                              background: "rgba(255,255,255,0.08)",
                              outline: "none",
                              resize: "vertical",
                            }}
                          />

                          <div style={{ display: "flex", gap: 8 }}>
                            <button
                              onClick={() => saveEdit(c.id)}
                              disabled={busyActionId === c.id || !editingBody.trim()}
                              style={{
                                flex: 1,
                                padding: 10,
                                borderRadius: 12,
                                border: `1px solid ${BORDER}`,
                                background: "rgba(255,255,255,0.10)",
                                color: TEXT_LIGHT,
                                cursor: busyActionId === c.id ? "default" : "pointer",
                                fontWeight: 900,
                                fontSize: 12,
                              }}
                            >
                              {busyActionId === c.id ? "Zapisuję..." : "Zapisz"}
                            </button>

                            <button
                              onClick={() => {
                                setEditingId(null);
                                setEditingBody("");
                              }}
                              style={{
                                flex: 1,
                                padding: 10,
                                borderRadius: 12,
                                border: `1px solid ${BORDER}`,
                                background: "rgba(255,255,255,0.05)",
                                color: TEXT_LIGHT,
                                cursor: "pointer",
                                fontWeight: 900,
                                fontSize: 12,
                              }}
                            >
                              Anuluj
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* WSZYSTKIE WPISY */}
          <div style={{ height: 1, background: BORDER, opacity: 0.9 }} />

          <div style={{ display: "grid", gap: 8 }}>
            <div>
              <div style={sectionTitleStyle}>Wszystkie wpisy</div>
              <div style={sectionHintStyle}>Pełna historia projektu.</div>
            </div>

            {items.length === 0 ? (
              <div style={{ fontSize: 12, color: MUTED }}>Brak wpisów dla tego projektu.</div>
            ) : (
              <div style={{ ...listWrapStyle, maxHeight: maxHeightAll }}>
                {items.map((c) => {
                  const isMine = String(c.user_id) === String(user?.id);
                  const isEditing = String(editingId) === String(c.id);

                  return (
                    <div key={`all-${c.id}`} style={cardItemStyle}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                        <div style={metaStyle}>
                          <b style={{ color: "rgba(255,255,255,0.92)" }}>
                            {c.user_email || "użytkownik"}
                          </b>{" "}
                          • {formatDateTimePL(c.created_at)}
                          {c.edited ? (
                            <span style={{ marginLeft: 6, opacity: 0.8 }}>(edytowano)</span>
                          ) : null}
                        </div>

                        {isMine ? (
                          <div style={{ display: "flex", gap: 8 }}>
                            {!isEditing ? (
                              <button
                                onClick={() => {
                                  setEditingId(c.id);
                                  setEditingBody(c.body || "");
                                }}
                                style={smallBtnStyle}
                              >
                                Edytuj
                              </button>
                            ) : null}

                            <button
                              onClick={() => removeComment(c.id)}
                              disabled={busyActionId === c.id}
                              style={{
                                ...smallBtnStyle,
                                border: "1px solid rgba(255,80,80,0.55)",
                                background: "rgba(255,80,80,0.12)",
                              }}
                            >
                              {busyActionId === c.id ? "..." : "Usuń"}
                            </button>
                          </div>
                        ) : null}
                      </div>

                      {!isEditing ? (
                        <div style={bodyTextStyle}>{c.body}</div>
                      ) : (
                        <div style={{ display: "grid", gap: 8 }}>
                          <textarea
                            className="journalTextarea"
                            rows={2}
                            value={editingBody}
                            onChange={(e) => setEditingBody(e.target.value)}
                            style={{
                              padding: 8,
                              borderRadius: 12,
                              border: `1px solid ${BORDER}`,
                              background: "rgba(255,255,255,0.08)",
                              outline: "none",
                              resize: "vertical",
                            }}
                          />

                          <div style={{ display: "flex", gap: 8 }}>
                            <button
                              onClick={() => saveEdit(c.id)}
                              disabled={busyActionId === c.id || !editingBody.trim()}
                              style={{
                                flex: 1,
                                padding: 10,
                                borderRadius: 12,
                                border: `1px solid ${BORDER}`,
                                background: "rgba(255,255,255,0.10)",
                                color: TEXT_LIGHT,
                                cursor: busyActionId === c.id ? "default" : "pointer",
                                fontWeight: 900,
                                fontSize: 12,
                              }}
                            >
                              {busyActionId === c.id ? "Zapisuję..." : "Zapisz"}
                            </button>

                            <button
                              onClick={() => {
                                setEditingId(null);
                                setEditingBody("");
                              }}
                              style={{
                                flex: 1,
                                padding: 10,
                                borderRadius: 12,
                                border: `1px solid ${BORDER}`,
                                background: "rgba(255,255,255,0.05)",
                                color: TEXT_LIGHT,
                                cursor: "pointer",
                                fontWeight: 900,
                                fontSize: 12,
                              }}
                            >
                              Anuluj
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <button
            onClick={load}
            disabled={loading}
            style={{
              padding: 10,
              borderRadius: 12,
              border: `1px solid ${BORDER}`,
              background: "rgba(255,255,255,0.06)",
              color: TEXT_LIGHT,
              cursor: loading ? "default" : "pointer",
              fontWeight: 900,
              fontSize: 12,
              width: "fit-content",
              justifySelf: "start",
            }}
          >
            {loading ? "Odświeżam..." : "Odśwież dziennik"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function RecentUpdatesPanel({
  user,
  authFetch,
  API,
  BORDER,
  MUTED,
  TEXT_LIGHT,
  GLASS_BG,
  GLASS_SHADOW,
  onUnauthorized,
  onJumpToProject,
  updatesTick,
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [items, setItems] = useState([]);
  const [expanded, setExpanded] = useState({});

  async function load() {
    setLoading(true);
    setErr("");
    try {
      const res = await authFetch(`${API}/updates/recent?limit=30`);
      const data = await readJsonOrThrow(res);
      const list = Array.isArray(data) ? data : [];
      setItems(list);
    } catch (e) {
      if (e?.status === 401) return onUnauthorized?.();
      setErr(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  async function markAllRead() {
    if (items.length === 0) return;

    // optymistycznie
    setItems([]);
    setExpanded({});

    try {
      const res = await authFetch(`${API}/updates/read-all?limit=500`, {
        method: "POST",
      });
      await readJsonOrThrow(res);
      setOpen(false); // auto-zamknięcie
    } catch (e) {
      if (e?.status === 401) return onUnauthorized?.();
      setErr(String(e?.message || e));
      load();
    }
  }

  async function markRead(u) {
    const itemKey = `${u.kind}:${u.entity_id}:${u.id}`;

    // optymistycznie usuń z UI od razu
    setItems((prev) => prev.filter((x) => `${x.kind}:${x.entity_id}:${x.id}` !== itemKey));
    setExpanded((prev) => {
      const next = { ...(prev || {}) };
      delete next[itemKey];
      return next;
    });

    try {
      const res = await authFetch(`${API}/updates/read`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: u.kind,
          entity_id: u.entity_id,
          comment_id: u.id,
        }),
      });
      await readJsonOrThrow(res);
    } catch (e) {
      if (e?.status === 401) return onUnauthorized?.();
      setErr(String(e?.message || e));
      load();
    }
  }

  useEffect(() => {
    if (!user?.id) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, updatesTick]);

  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        transform: "translateX(-50%)",
        bottom: 12,
        width: "min(760px, calc(100% - 420px))",
        maxWidth: "52vw",
        zIndex: 1700,
        borderRadius: 16,
        border: `1px solid ${BORDER}`,
        background: GLASS_BG,
        backgroundImage:
          "radial-gradient(700px 420px at 20% 10%, rgba(255,255,255,0.10), transparent 60%)",
        color: TEXT_LIGHT,
        boxShadow: GLASS_SHADOW,
        overflow: "hidden",
        backdropFilter: "blur(8px)",
      }}
    >
      {/* HEADER */}
      <div
        style={{
          padding: "10px 12px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 10,
          fontWeight: 900,
          background: "rgba(0,0,0,0.10)",
        }}
      >
        <button
          onClick={() => setOpen((o) => !o)}
          style={{
            all: "unset",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 10,
            minWidth: 0,
            flex: 1,
          }}
          title={open ? "Zwiń" : "Rozwiń"}
        >
          <span style={{ whiteSpace: "nowrap" }}>Najnowsze aktualizacje</span>

          {items.length > 0 ? (
            <span
              style={{
                minWidth: 26,
                height: 22,
                padding: "0 8px",
                borderRadius: 999,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 12,
                fontWeight: 900,
                color: "rgba(255,255,255,0.92)",
                background: "rgba(239,68,68,0.22)",
                border: "1px solid rgba(239,68,68,0.55)",
                boxShadow: "0 0 18px rgba(239,68,68,0.15)",
                flexShrink: 0,
                animation:
                  !open && items.length > 0 ? "pulseBadge 1.2s ease-in-out infinite" : "none",
              }}
              title="Liczba nieprzeczytanych aktualizacji"
            >
              {items.length}
            </span>
          ) : (
            <span
              style={{
                minWidth: 26,
                height: 22,
                padding: "0 10px",
                borderRadius: 999,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 12,
                fontWeight: 900,
                color: "rgba(34,197,94,0.95)",
                background: "rgba(34,197,94,0.08)",
                border: "1px solid rgba(34,197,94,0.55)",
                boxShadow: "0 0 12px rgba(34,197,94,0.18)",
                flexShrink: 0,
              }}
              title="Brak nowych aktualizacji"
            >
              Brak
            </span>
          )}

          <span
            style={{
              fontSize: 10,
              color: MUTED,
              fontWeight: 700,
              whiteSpace: "nowrap",
              marginLeft: 10,
              opacity: 0.85,
            }}
          >
            {open ? "Kliknij, żeby zminimalizować" : "Rozwiń, żeby zobaczyć więcej"}
          </span>

          <span style={{ fontSize: 12, color: MUTED, marginLeft: "auto" }}>{open ? "▾" : "▸"}</span>
        </button>

        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              load();
            }}
            disabled={loading}
            style={{
              padding: "10px 12px",
              borderRadius: 12,
              border: `1px solid ${BORDER}`,
              background: "rgba(255,255,255,0.06)",
              color: TEXT_LIGHT,
              cursor: loading ? "default" : "pointer",
              fontWeight: 900,
              fontSize: 12,
            }}
          >
            {loading ? "Odświeżam..." : "Odśwież"}
          </button>

          <button
            onClick={(e) => {
              e.stopPropagation();
              markAllRead();
            }}
            disabled={items.length === 0}
            title="Oznacz wszystkie widoczne aktualizacje jako przeczytane"
            style={{
              padding: "10px 12px",
              borderRadius: 12,
              border: `1px solid ${BORDER}`,
              background: "rgba(255,255,255,0.06)",
              color: TEXT_LIGHT,
              cursor: items.length === 0 ? "default" : "pointer",
              fontWeight: 900,
              fontSize: 12,
              transition: "background 120ms ease, border-color 120ms ease, transform 120ms ease",
            }}
            className="markAllBtn"
          >
            Wszystko przeczytane
          </button>
        </div>
      </div>

      {/* BODY */}
      {open ? (
        <div style={{ padding: 12, display: "grid", gap: 10 }}>
          {err ? (
            <div
              style={{
                padding: 10,
                borderRadius: 14,
                border: "1px solid rgba(255,120,120,0.45)",
                background: "rgba(255,120,120,0.12)",
                color: "rgba(255,255,255,0.95)",
                fontSize: 12,
              }}
            >
              {err}
            </div>
          ) : null}

          {items.length === 0 ? (
            <div style={{ fontSize: 12, color: MUTED }}>Brak nowych aktualizacji 🎉</div>
          ) : (
            <div
              style={{
                maxHeight: 280,
                overflow: "auto",
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
                gap: 10,
                paddingRight: 4,
              }}
            >
              {items.map((u) => {
                const itemKey = `${u.kind}:${u.entity_id}:${u.id}`;
                const isExpanded = !!expanded[itemKey];

                return (
                  <div
                    key={itemKey}
                    style={{
                      borderRadius: 14,
                      border: `1px solid ${BORDER}`,
                      background: "rgba(255,255,255,0.05)",
                      padding: 10,
                      position: "relative",
                      display: "grid",
                      gap: 8,
                    }}
                  >
                    <button
                      className="tickBtn"
                      onClick={(e) => {
                        e.stopPropagation();
                        markRead(u);
                      }}
                      title="Odczytane"
                      style={{
                        position: "absolute",
                        top: 8,
                        right: 8,
                        width: 34,
                        height: 34,
                        borderRadius: 12,
                        border: `1px solid ${BORDER}`,
                        background: "rgba(255,255,255,0.08)",
                        color: "rgba(255,255,255,0.85)",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: 0,
                        lineHeight: 0,
                        pointerEvents: "auto",
                        zIndex: 5,
                      }}
                    >
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                        style={{ display: "block", pointerEvents: "none" }}
                      >
                        <path
                          d="M20 6L9 17l-5-5"
                          stroke="currentColor"
                          strokeWidth="2.6"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>

                    <div style={{ fontSize: 12, color: MUTED, paddingRight: 44 }}>
                      <b style={{ color: "rgba(255,255,255,0.92)" }}>
                        {u.entity_title || `${u.kind} #${u.entity_id}`}
                      </b>{" "}
                      • {u.user_email || "użytkownik"} • {formatDateTimePL(u.created_at)}
                      {u.edited ? (
                        <span style={{ marginLeft: 6, opacity: 0.8 }}>(edytowano)</span>
                      ) : null}
                    </div>

                    <div
                      style={{
                        whiteSpace: "pre-wrap",
                        paddingRight: 44,
                        fontSize: 13,
                        lineHeight: 1.35,
                        ...(isExpanded
                          ? {}
                          : {
                              display: "-webkit-box",
                              WebkitLineClamp: 3,
                              WebkitBoxOrient: "vertical",
                              overflow: "hidden",
                            }),
                      }}
                    >
                      {u.body}
                    </div>

                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onJumpToProject?.(u.kind, u.entity_id);
                        }}
                        style={{
                          padding: "8px 10px",
                          borderRadius: 12,
                          border: `1px solid ${BORDER}`,
                          background: "rgba(255,255,255,0.06)",
                          color: TEXT_LIGHT,
                          cursor: "pointer",
                          fontWeight: 900,
                          fontSize: 12,
                        }}
                      >
                        Pokaż na mapie
                      </button>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpanded((prev) => ({
                            ...(prev || {}),
                            [itemKey]: !prev?.[itemKey],
                          }));
                        }}
                        style={{
                          padding: "8px 10px",
                          borderRadius: 12,
                          border: `1px solid ${BORDER}`,
                          background: "rgba(255,255,255,0.05)",
                          color: TEXT_LIGHT,
                          cursor: "pointer",
                          fontWeight: 900,
                          fontSize: 12,
                        }}
                      >
                        {isExpanded ? "Zwiń" : "Pokaż więcej"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** ===== EDIT MODAL ===== */
function EditProjectModal({
  open,
  kind, // "points" | "tunnels"
  entity, // selectedPoint | selectedTunnel
  onClose,
  onSave, // async (payload) => void
  BORDER,
  TEXT_LIGHT,
  MUTED,
  GLASS_BG,
}) {
  const [form, setForm] = useState({
    titleOrName: "",
    status: "planowany",
    director: "",
    winner: "",
    note: "",
    acquired: false,
    lost: false,
  });

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open || !entity) return;

    setErr("");
    setSaving(false);

    setForm({
      titleOrName: kind === "points" ? entity.title ?? "" : entity.name ?? "",
      status: entity.status ?? "planowany",
      director: entity.director ?? "",
      winner: entity.winner ?? "",
      note: entity.note ?? "",
      acquired: !!entity.acquired,
      lost: !!entity.lost,
    });
  }, [open, kind, entity]);

  if (!open || !entity) return null;

  const title =
    kind === "points"
      ? `Edycja punktu: ${entity.title || `#${entity.id}`}`
      : `Edycja tunelu: ${entity.name || `#${entity.id}`}`;

  async function handleSave() {
    setErr("");

    const payload = {
      status: String(form.status || "planowany"),
      director: String(form.director || ""),
      winner: String(form.winner || ""),
      note: String(form.note || ""),
      acquired: !!form.acquired,
      lost: !!form.lost,
    };

    if (kind === "points") payload.title = String(form.titleOrName || "");
    else payload.name = String(form.titleOrName || "");

    const key = kind === "points" ? "title" : "name";
    if (!String(payload[key] || "").trim()) {
      setErr(kind === "points" ? "Tytuł nie może być pusty." : "Nazwa nie może być pusta.");
      return;
    }

    setSaving(true);
    try {
      await onSave(payload);
      onClose();
    } catch (e) {
      setErr(String(e?.message || e));
    } finally {
      setSaving(false);
    }
  }

  const overlayStyle = {
    position: "fixed",
    inset: 0,
    zIndex: 9999,
    background: "rgba(0,0,0,0.55)",
    display: "grid",
    placeItems: "center",
    padding: 16,
  };

  const modalStyle = {
    width: "min(640px, 100%)",
    borderRadius: 16,
    border: `1px solid ${BORDER}`,
    background: GLASS_BG,
    backgroundImage:
      "radial-gradient(700px 420px at 20% 10%, rgba(255,255,255,0.10), transparent 60%)",
    color: TEXT_LIGHT,
    boxShadow: "0 18px 55px rgba(0,0,0,0.55)",
    overflow: "hidden",
    backdropFilter: "blur(10px)",
  };

  const headerStyle = {
    padding: "10px 12px",
    borderBottom: `1px solid ${BORDER}`,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
    fontWeight: 900,
    background: "rgba(0,0,0,0.10)",
  };

  const bodyStyle = {
    padding: 12,
    display: "grid",
    gap: 10,
  };

  const labelStyleLocal = {
    fontSize: 12,
    color: MUTED,
    fontWeight: 800,
    marginTop: 2,
  };

  const inputStyleLocal = {
    boxSizing: "border-box",
    width: "100%",
    height: 38,
    borderRadius: 12,
    border: `1px solid ${BORDER}`,
    background: "rgba(255,255,255,0.08)",
    color: TEXT_LIGHT,
    padding: "0 12px",
    outline: "none",
    fontSize: 12,
    fontWeight: 700,
  };

  const textareaStyleLocal = {
    ...inputStyleLocal,
    height: 92,
    padding: 10,
    resize: "vertical",
    lineHeight: 1.35,
  };

  const btnStyle = {
    padding: "9px 10px",
    borderRadius: 12,
    border: `1px solid ${BORDER}`,
    background: "rgba(255,255,255,0.08)",
    color: TEXT_LIGHT,
    cursor: "pointer",
    fontWeight: 900,
    fontSize: 12,
    transition: "transform 120ms ease, background 120ms ease, border-color 120ms ease",
  };

  const toggleTileStyle = (active, tone) => {
    const base = {
      display: "flex",
      alignItems: "center",
      gap: 10,
      cursor: "pointer",
      userSelect: "none",
      fontWeight: 800,
      fontSize: 12,
      padding: "10px 12px",
      borderRadius: 12,
      border: `1px solid ${BORDER}`,
      background: "rgba(255,255,255,0.05)",
      color: MUTED,
    };

    if (!active) return base;

    if (tone === "green") {
      return {
        ...base,
        color: "rgba(34,197,94,0.95)",
        border: "1px solid rgba(34,197,94,0.55)",
        background: "rgba(34,197,94,0.10)",
        boxShadow: "0 0 14px rgba(34,197,94,0.14)",
      };
    }

    return {
      ...base,
      color: "rgba(239,68,68,0.95)",
      border: "1px solid rgba(239,68,68,0.55)",
      background: "rgba(239,68,68,0.10)",
      boxShadow: "0 0 14px rgba(239,68,68,0.12)",
    };
  };

  return (
    <div
      style={overlayStyle}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div style={modalStyle}>
        <div style={headerStyle}>
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 13,
                lineHeight: 1.15,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {title}
            </div>
            <div style={{ fontSize: 11, color: MUTED, opacity: 0.9, marginTop: 2 }}>
              Dostosuj dane projektu i zapisz zmiany.
            </div>
          </div>

          <button
            onClick={onClose}
            style={{
              ...btnStyle,
              padding: "8px 10px",
              background: "rgba(255,255,255,0.06)",
              flexShrink: 0,
            }}
          >
            Zamknij
          </button>
        </div>

        <div style={bodyStyle}>
          {err ? (
            <div
              style={{
                padding: 10,
                borderRadius: 14,
                border: "1px solid rgba(255,120,120,0.45)",
                background: "rgba(255,120,120,0.12)",
                color: "rgba(255,255,255,0.95)",
                fontSize: 12,
              }}
            >
              {err}
            </div>
          ) : null}

          <label style={labelStyleLocal}>{kind === "points" ? "Tytuł" : "Nazwa"}</label>
          <input
            value={form.titleOrName}
            onChange={(e) => setForm((f) => ({ ...f, titleOrName: e.target.value }))}
            style={inputStyleLocal}
          />

          <label style={labelStyleLocal}>Status</label>
          <select
            value={form.status}
            onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
            style={inputStyleLocal}
          >
            <option value="planowany">planowany</option>
            <option value="przetarg">przetarg</option>
            <option value="realizacja">realizacja</option>
            <option value="nieaktualny">nieaktualny</option>
          </select>

          {/* Pozyskany / Przegrany */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 2 }}>
            <label style={toggleTileStyle(!!form.acquired, "green")}>
              <input
                type="checkbox"
                checked={!!form.acquired}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    acquired: e.target.checked,
                    lost: e.target.checked ? false : f.lost,
                  }))
                }
              />
              Projekt pozyskany
            </label>

            <label style={toggleTileStyle(!!form.lost, "red")}>
              <input
                type="checkbox"
                checked={!!form.lost}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    lost: e.target.checked,
                    acquired: e.target.checked ? false : f.acquired,
                  }))
                }
              />
              Projekt przegrany
            </label>
          </div>

          <label style={labelStyleLocal}>Dyrektor</label>
          <input
            value={form.director}
            onChange={(e) => setForm((f) => ({ ...f, director: e.target.value }))}
            style={inputStyleLocal}
          />

          <label style={labelStyleLocal}>Firma</label>
          <input
            value={form.winner}
            onChange={(e) => setForm((f) => ({ ...f, winner: e.target.value }))}
            style={inputStyleLocal}
          />

          <label style={labelStyleLocal}>Opis projektu</label>
          <textarea
            value={form.note}
            onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
            style={textareaStyleLocal}
          />

          <div style={{ height: 1, background: BORDER, opacity: 0.9, marginTop: 2 }} />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <button
              onClick={onClose}
              style={{
                ...btnStyle,
                background: "rgba(255,255,255,0.05)",
              }}
            >
              Anuluj
            </button>

            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                ...btnStyle,
                background: "rgba(255,255,255,0.10)",
                opacity: saving ? 0.75 : 1,
                cursor: saving ? "default" : "pointer",
              }}
            >
              {saving ? "Zapisuję..." : "Zapisz"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function MapAutoDeselect({ enabled, onDeselect, mapRef, suppressRef }) {
  useMapEvents({
    click(e) {
      if (!enabled) return;
      if (suppressRef?.current) return;

      const target = e?.originalEvent?.target;
      if (!target) return;

      const isInteractive = target.closest(
        ".leaflet-marker-icon, .leaflet-interactive, .leaflet-popup, .leaflet-control, .leaflet-tooltip"
      );

      if (isInteractive) return;

      try {
        mapRef?.current?.closePopup?.();
      } catch {}

      onDeselect?.();
    },
  });

  return null;
}

export default function App() {
  /** ===== Leaflet Draw init ===== */
  const [drawReady, setDrawReady] = useState(false);

  const drawPolylineRef = useRef(null);
  const editToolRef = useRef(null);
  const deleteToolRef = useRef(null);

  // active tool UI highlight
  const [activeDrawTool, setActiveDrawTool] = useState("draw"); // draw | edit | delete

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        window.L = L;
        await import("leaflet-draw");
        if (!alive) return;
        setDrawReady(true);
      } catch (e) {
        console.error("Leaflet draw init failed:", e);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  const [projectQuery, setProjectQuery] = useState("");

  /** ===== global refresh trigger for updates feed ===== */
  const [updatesTick, setUpdatesTick] = useState(0);
  function bumpUpdates() {
    setUpdatesTick((x) => x + 1);
  }

  /** ===== JOURNAL COUNTS + ACQUIRED (localStorage) ===== */
  const [journalCounts, setJournalCounts] = useState(() => {
    try {
      const raw = localStorage.getItem("journalCounts");
      const parsed = raw ? JSON.parse(raw) : null;
      return {
        points: parsed?.points && typeof parsed.points === "object" ? parsed.points : {},
        tunnels: parsed?.tunnels && typeof parsed.tunnels === "object" ? parsed.tunnels : {},
      };
    } catch {
      return { points: {}, tunnels: {} };
    }
  });

  function handleCountsChange(kind, id, count) {
    setJournalCounts((prev) => ({
      ...prev,
      [kind]: { ...(prev[kind] || {}), [id]: Number(count) || 0 },
    }));
  }
  useEffect(() => {
    try {
      localStorage.setItem(
        "journalCounts",
        JSON.stringify(journalCounts || { points: {}, tunnels: {} })
      );
    } catch {}
  }, [journalCounts]);

  const [acquiredMap, setAcquiredMap] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("acquiredMap") || "{}") || {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem("acquiredMap", JSON.stringify(acquiredMap || {}));
    } catch {}
  }, [acquiredMap]);

  function isAcquired(kind, id) {
    return acquiredMap?.[`${kind}:${id}`] === true;
  }

  function setAcquired(kind, id, value) {
    setAcquiredMap((prev) => ({
      ...(prev || {}),
      [`${kind}:${id}`]: !!value,
    }));
  }

  /** ===== AUTH ===== */
  const [mode, setMode] = useState("checking"); // checking | login | app
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [loadingAuth, setLoadingAuth] = useState(false);
  const [user, setUser] = useState(null);
  const [authNotice, setAuthNotice] = useState("");

  useEffect(() => {
    async function boot() {
      try {
        const token = getToken();
        if (!token) {
          setMode("login");
          return;
        }
        const me = await meRequest();
        setUser(me.user);
        setMode("app");
      } catch {
        setToken(null);
        setMode("login");
      }
    }
    boot();
  }, []);

  async function onLoginSubmit(e) {
    e.preventDefault();
    setErr("");
    setLoadingAuth(true);

    try {
      const data = await loginRequest(login, password);
      setToken(data.token);
      setUser(data.user);
      setAuthNotice("");
      setMode("app");
    } catch (e2) {
      setErr(e2?.message || "Błąd logowania");
    } finally {
      setLoadingAuth(false);
    }
  }

  function logout(reason) {
    setToken(null);
    setUser(null);
    setLogin("");
    setPassword("");
    setErr("");
    setMode("login");

    setSelectedPointId(null);
    setPoints([]);

    setSelectedTunnelId(null);
    setTunnels([]);

    if (reason === "expired") setAuthNotice("Sesja wygasła — zaloguj się ponownie.");
    else setAuthNotice("");
  }

  async function authFetch(url, options = {}) {
    const headers = { ...(options.headers || {}) };
    const t = getToken();
    if (t) headers.Authorization = `Bearer ${t}`;
    return fetch(url, { ...options, headers });
  }

  /** ===== POINTS ===== */
  const [points, setPoints] = useState([]);
  const [selectedPointId, setSelectedPointId] = useState(null);

  const selectedPoint = useMemo(
    () => points.find((p) => p.id === selectedPointId) || null,
    [points, selectedPointId]
  );

  const [loadingPoints, setLoadingPoints] = useState(false);
  const [apiError, setApiError] = useState("");

  const pinIcons = useMemo(() => {
    return {
      planowany: makePinIcon(statusColor("planowany")),
      przetarg: makePinIcon(statusColor("przetarg")),
      realizacja: makePinIcon(statusColor("realizacja")),
      nieaktualny: makePinIcon(statusColor("nieaktualny")),
    };
  }, []);

  /** ===== TUNNELS ===== */
  const [tunnels, setTunnels] = useState([]);
  const [selectedTunnelId, setSelectedTunnelId] = useState(null);

  const selectedTunnel = useMemo(
    () => tunnels.find((t) => t.id === selectedTunnelId) || null,
    [tunnels, selectedTunnelId]
  );

  const [loadingTunnels, setLoadingTunnels] = useState(false);

  const drawGroupRef = useRef(null);

  /** ===== Map + refs (zoom/popup) ===== */
  const mapRef = useRef(null);
  const markerRefs = useRef({});
  const tunnelRefs = useRef({});
  const suppressNextMapClickRef = useRef(false);

  /** ===== Filters + Add mode ===== */
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [addMode, setAddMode] = useState("none"); // none | point | tunnel
  const [visibleStatus, setVisibleStatus] = useState({
    planowany: true,
    przetarg: true,
    realizacja: true,
    nieaktualny: false, // domyślnie OFF
  });

  /** ===== EDIT ===== */
  const [editOpen, setEditOpen] = useState(false);

  function byPriorityThenIdDesc(a, b) {
    const ap = a?.priority === true ? 1 : 0;
    const bp = b?.priority === true ? 1 : 0;
    if (bp !== ap) return bp - ap;
    return Number(b.id) - Number(a.id);
  }

  const filteredPoints = useMemo(() => {
    return points
      .filter((p) => visibleStatus[p.status || "planowany"] !== false)
      .slice()
      .sort(byPriorityThenIdDesc);
  }, [points, visibleStatus]);

  const filteredTunnels = useMemo(() => {
    return tunnels
      .filter((t) => visibleStatus[t.status || "planowany"] !== false)
      .slice()
      .sort(byPriorityThenIdDesc);
  }, [tunnels, visibleStatus]);

  const filteredProjects = useMemo(() => {
    const pts = (filteredPoints || []).map((p) => ({ ...p, kind: "point" }));
    const tls = (filteredTunnels || []).map((t) => ({ ...t, kind: "tunnel" }));
    return [...pts, ...tls].slice().sort(byPriorityThenIdDesc);
  }, [filteredPoints, filteredTunnels]);

  const filteredProjectsSearch = useMemo(() => {
    const q = String(projectQuery || "").trim().toLowerCase();
    if (!q) return filteredProjects;

    return filteredProjects.filter((x) => {
      const name = x.kind === "tunnel" ? x.name : x.title;
      const label = String(name || "").toLowerCase();
      const idStr = String(x.id);
      return label.includes(q) || idStr.includes(q);
    });
  }, [filteredProjects, projectQuery]);

  const counts = useMemo(() => {
    const c = { planowany: 0, przetarg: 0, realizacja: 0, nieaktualny: 0 };
    for (const p of points) {
      const st = p.status || "planowany";
      c[st] = (c[st] || 0) + 1;
    }
    for (const t of tunnels) {
      const st = t.status || "planowany";
      c[st] = (c[st] || 0) + 1;
    }
    return c;
  }, [points, tunnels]);

  function toggleStatus(key) {
    setVisibleStatus((s) => ({ ...s, [key]: !s[key] }));
  }
  function showAllStatuses() {
    setVisibleStatus({
      planowany: true,
      przetarg: true,
      realizacja: true,
      nieaktualny: true,
    });
  }
  function hideAllStatuses() {
    setVisibleStatus({
      planowany: false,
      przetarg: false,
      realizacja: false,
      nieaktualny: false,
    });
  }

  function focusPoint(pt) {
    const map = mapRef.current;
    if (!map || !pt) return;

    const lat = Number(pt.lat);
    const lng = Number(pt.lng);

    map.flyTo([lat, lng], Math.max(map.getZoom(), 12), {
      animate: true,
      duration: 0.6,
    });

    setTimeout(() => {
      const m = markerRefs.current[pt.id];
      try {
        m?.openPopup?.();
      } catch {}
    }, 250);
  }

  function focusTunnel(t) {
    const map = mapRef.current;
    if (!map || !t) return;

    const latlngs = (t.path || []).map((p) => [Number(p.lat), Number(p.lng)]);
    if (latlngs.length === 0) return;

    try {
      const bounds = L.latLngBounds(latlngs);
      map.fitBounds(bounds, { padding: [40, 40], animate: true, duration: 0.6 });
    } catch {}

    setTimeout(() => {
      const pl = tunnelRefs.current[t.id];
      try {
        pl?.openPopup?.();
      } catch {}
    }, 250);
  }

  function jumpToProject(kind, entityId) {
    if (kind === "points") {
      const pt = points.find((x) => String(x.id) === String(entityId));
      if (!pt) return;
      setSelectedPointId(pt.id);
      setSelectedTunnelId(null);
      focusPoint(pt);
      return;
    }

    if (kind === "tunnels") {
      const t = tunnels.find((x) => String(x.id) === String(entityId));
      if (!t) return;
      setSelectedTunnelId(t.id);
      setSelectedPointId(null);
      focusTunnel(t);
    }
  }

  /** ===== World mask ===== */
  const [worldMask, setWorldMask] = useState(null);
  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const res = await fetch(NE_COUNTRIES_URL);
        if (!res.ok) throw new Error(`GeoJSON HTTP ${res.status}`);
        const fc = await res.json();

        const keepFeatures = (fc.features || []).filter((f) => {
          const a3 =
            f?.properties?.ADM0_A3 || f?.properties?.ISO_A3 || f?.properties?.iso_a3;
          return KEEP_COUNTRIES_A3.has(a3);
        });

        const holes = [];
        for (const f of keepFeatures) holes.push(...extractOuterRings(f.geometry));

        const mask = {
          type: "Feature",
          properties: { name: "world-mask" },
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [-180, -90],
                [180, -90],
                [180, 90],
                [-180, 90],
                [-180, -90],
              ],
              ...holes,
            ],
          },
        };

        if (alive) setWorldMask(mask);
      } catch {
        if (alive) setWorldMask(null);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  /** ===== Load data ===== */
  async function loadPoints() {
    setLoadingPoints(true);
    setApiError("");
    try {
      const res = await authFetch(`${API}/points`);
      const data = await readJsonOrThrow(res);
      setPoints(
        Array.isArray(data) ? data.map((p) => ({ ...p, priority: p.priority === true })) : []
      );
    } catch (e) {
      if (e?.status === 401) return logout("expired");
      setApiError(`Nie mogę pobrać punktów: ${String(e)}`);
    } finally {
      setLoadingPoints(false);
    }
  }

  async function loadTunnels() {
    setLoadingTunnels(true);
    setApiError("");
    try {
      const res = await authFetch(`${API}/tunnels`);
      const data = await readJsonOrThrow(res);
      setTunnels(
        Array.isArray(data) ? data.map((t) => ({ ...t, priority: t.priority === true })) : []
      );
    } catch (e) {
      if (e?.status === 401) return logout("expired");
      setApiError(`Nie mogę pobrać tuneli: ${String(e)}`);
    } finally {
      setLoadingTunnels(false);
    }
  }

  useEffect(() => {
    if (mode !== "app") return;
    loadPoints();
    loadTunnels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  async function deleteSelectedProject() {
    const pt = selectedPoint;
    const tl = selectedTunnel;

    if (!pt && !tl) return;

    const label = pt
      ? `punkt #${pt.id} (${pt.title || "bez tytułu"})`
      : `tunel #${tl.id} (${tl.name || "bez nazwy"})`;

    const ok = window.confirm(`Na pewno usunąć ${label}?`);
    if (!ok) return;

    setApiError("");

    try {
      if (pt) {
        const res = await authFetch(`${API}/points/${pt.id}`, { method: "DELETE" });
        await readJsonOrThrow(res);

        setPoints((prev) => prev.filter((p) => p.id !== pt.id));
        setSelectedPointId(null);
      } else {
        const res = await authFetch(`${API}/tunnels/${tl.id}`, { method: "DELETE" });
        await readJsonOrThrow(res);

        setTunnels((prev) => prev.filter((t) => t.id !== tl.id));
        setSelectedTunnelId(null);
      }

      try {
        mapRef.current?.closePopup?.();
      } catch {}
    } catch (e) {
      if (e?.status === 401) return logout("expired");
      setApiError(`Nie mogę usunąć: ${String(e?.message || e)}`);

      try {
        await loadPoints();
        await loadTunnels();
      } catch {}
    }
  }

  async function saveEditedProject(payload) {
    const pt = selectedPoint;
    const tl = selectedTunnel;
    if (!pt && !tl) return;

    setApiError("");

    try {
      if (pt) {
        const res = await authFetch(`${API}/points/${pt.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lat: pt.lat,
            lng: pt.lng,
            title: payload.title,
            director: payload.director,
            winner: payload.winner,
            note: payload.note,
            status: payload.status,
          }),
        });

        const updated = await readJsonOrThrow(res);
        setPoints((prev) =>
          prev.map((p) =>
            p.id === updated.id ? { ...updated, priority: updated.priority === true } : p
          )
        );
        setSelectedPointId(updated.id);
        setAcquired("points", updated.id, !!payload.acquired);
      } else {
        const res = await authFetch(`${API}/tunnels/${tl.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            path: tl.path || [],
            name: payload.name,
            director: payload.director,
            winner: payload.winner,
            note: payload.note,
            status: payload.status,
          }),
        });

        const updated = await readJsonOrThrow(res);
        setTunnels((prev) =>
          prev.map((t) =>
            t.id === updated.id ? { ...updated, priority: updated.priority === true } : t
          )
        );
        setSelectedTunnelId(updated.id);
        setAcquired("tunnels", updated.id, !!payload.acquired);
      }
    } catch (e) {
      if (e?.status === 401) return logout("expired");
      throw e;
    }
  }

  async function togglePointPriority(pt) {
    if (!pt) return;
    setApiError("");
    try {
      const res = await authFetch(`${API}/points/${pt.id}/priority`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priority: !(pt.priority === true) }),
      });
      const updated = await readJsonOrThrow(res);
      setPoints((prev) =>
        prev.map((p) =>
          p.id === updated.id ? { ...updated, priority: updated.priority === true } : p
        )
      );
    } catch (e) {
      if (e?.status === 401) return logout("expired");
      setApiError(`Nie mogę ustawić priorytetu punktu: ${String(e?.message || e)}`);
    }
  }

  async function toggleTunnelPriority(t) {
    if (!t) return;
    setApiError("");
    try {
      const res = await authFetch(`${API}/tunnels/${t.id}/priority`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priority: !(t.priority === true) }),
      });
      const updated = await readJsonOrThrow(res);
      setTunnels((prev) =>
        prev.map((x) =>
          x.id === updated.id ? { ...updated, priority: updated.priority === true } : x
        )
      );
    } catch (e) {
      if (e?.status === 401) return logout("expired");
      setApiError(`Nie mogę ustawić priorytetu tunelu: ${String(e?.message || e)}`);
    }
  }

  /** ===== Points CRUD (dodawanie tylko) ===== */
  async function addPoint(latlng) {
    setApiError("");
    const body = {
      title: "Nowy punkt",
      director: "",
      winner: "",
      note: "",
      status: "planowany",
      lat: latlng.lat,
      lng: latlng.lng,
    };

    try {
      const res = await authFetch(`${API}/points`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await readJsonOrThrow(res);
      const normalized = { ...data, priority: data?.priority === true };

      setPoints((p) => [normalized, ...p]);
      setSelectedPointId(normalized.id);
      setSelectedTunnelId(null);

      focusPoint(normalized);
      setAddMode("none");
    } catch (e) {
      if (e?.status === 401) return logout("expired");
      setApiError(`Nie mogę dodać punktu: ${String(e)}`);
    }
  }

  /** ===== Leaflet Draw handlers ===== */
  async function onDrawCreated(e) {
    if (e.layerType !== "polyline") return;

    const latlngs = e.layer.getLatLngs();
    const path = toPath(latlngs);

    try {
      if (drawGroupRef.current) drawGroupRef.current.clearLayers();
    } catch {}

    setApiError("");
    try {
      const res = await authFetch(`${API}/tunnels`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Nowy tunel",
          director: "",
          winner: "",
          status: "planowany",
          note: "",
          path,
        }),
      });
      const data = await readJsonOrThrow(res);
      const normalized = { ...data, priority: data?.priority === true };

      setTunnels((prev) => [normalized, ...prev]);
      setSelectedTunnelId(normalized.id);
      setSelectedPointId(null);

      focusTunnel(normalized);
      setAddMode("none");
    } catch (err2) {
      if (err2?.status === 401) return logout("expired");
      setApiError(`Nie mogę dodać tunelu: ${String(err2)}`);
    }
  }

  async function onDrawEdited(e) {
    const layers = e.layers;
    const updates = [];

    layers.eachLayer((layer) => {
      const tunnelId = layer?.options?.tunnelId;
      if (!tunnelId) return;
      const latlngs = layer.getLatLngs();
      const path = toPath(latlngs);
      updates.push({ id: tunnelId, path });
    });

    if (updates.length === 0) return;

    setApiError("");
    try {
      for (const u of updates) {
        const t = tunnels.find((x) => x.id === u.id);
        if (!t) continue;

        const res = await authFetch(`${API}/tunnels/${u.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: t.name || "Tunel",
            director: t.director || "",
            winner: t.winner || "",
            status: t.status || "planowany",
            note: t.note || "",
            path: u.path,
          }),
        });
        const data = await readJsonOrThrow(res);
        const normalized = { ...data, priority: data?.priority === true };

        setTunnels((prev) => prev.map((x) => (x.id === normalized.id ? normalized : x)));
      }
    } catch (err2) {
      if (err2?.status === 401) return logout("expired");
      setApiError(`Nie mogę zapisać geometrii tunelu: ${String(err2)}`);
    }
  }

  async function onDrawDeleted(e) {
    const layers = e.layers;
    const ids = [];

    layers.eachLayer((layer) => {
      const tunnelId = layer?.options?.tunnelId;
      if (tunnelId) ids.push(tunnelId);
    });

    if (ids.length === 0) return;

    const ok = window.confirm(`Usunąć ${ids.length} tunel(e)?`);
    if (!ok) {
      loadTunnels();
      return;
    }

    setApiError("");
    try {
      for (const id of ids) {
        const res = await authFetch(`${API}/tunnels/${id}`, { method: "DELETE" });
        await readJsonOrThrow(res);
      }
      setTunnels((prev) => prev.filter((t) => !ids.includes(t.id)));
      if (ids.includes(selectedTunnelId)) setSelectedTunnelId(null);
    } catch (err2) {
      if (err2?.status === 401) return logout("expired");
      setApiError(`Nie mogę usunąć tunelu: ${String(err2)}`);
      loadTunnels();
    }
  }

  /** ===== Init Leaflet Draw tools + events ===== */
  useEffect(() => {
    const map = mapRef.current;
    const fg = drawGroupRef.current;

    if (!drawReady || !map || !fg) return;

    drawPolylineRef.current = new L.Draw.Polyline(map, {
      shapeOptions: { color: "#60a5fa", weight: 10, opacity: 0.9 },
    });

    editToolRef.current = new L.EditToolbar.Edit(map, {
      featureGroup: fg,
      selectedPathOptions: { maintainColor: true, opacity: 0.9, weight: 10 },
    });

    deleteToolRef.current = new L.EditToolbar.Delete(map, {
      featureGroup: fg,
    });

    const onCreated = (e) => {
      if (addMode !== "tunnel") return;

      try {
        fg.addLayer(e.layer);
      } catch {}

      onDrawCreated({ layerType: "polyline", layer: e.layer });

      try {
        drawPolylineRef.current?.disable?.();
        editToolRef.current?.disable?.();
        deleteToolRef.current?.disable?.();
      } catch {}

      setActiveDrawTool("draw");
      setAddMode("none");
    };

    const onEditedEv = (e) => {
      onDrawEdited({ layers: e.layers });
    };

    const onDeletedEv = (e) => {
      onDrawDeleted({ layers: e.layers });
      try {
        deleteToolRef.current?.disable?.();
      } catch {}
      setActiveDrawTool("draw");
    };

    map.on(L.Draw.Event.CREATED, onCreated);
    map.on(L.Draw.Event.EDITED, onEditedEv);
    map.on(L.Draw.Event.DELETED, onDeletedEv);

    return () => {
      map.off(L.Draw.Event.CREATED, onCreated);
      map.off(L.Draw.Event.EDITED, onEditedEv);
      map.off(L.Draw.Event.DELETED, onDeletedEv);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawReady, addMode, tunnels]);

  const toolBtnStyle = (active) => ({
    width: 36,
    height: 36,
    borderRadius: 10,
    border: active ? "1px solid rgba(96,165,250,0.70)" : `1px solid ${BORDER}`,
    background: active ? "rgba(96,165,250,0.14)" : "rgba(255,255,255,0.08)",
    color: TEXT_LIGHT,
    fontSize: 16,
    cursor: "pointer",
    display: "grid",
    placeItems: "center",
    lineHeight: 1,
    padding: 0,
    boxShadow: active ? "0 0 14px rgba(96,165,250,0.14)" : "none",
  });

  /** ===== LOGIN UI ===== */
  if (mode === "checking") {
    return (
      <div style={pageStyle}>
        <div style={{ color: "white", opacity: 0.85 }}>Sprawdzam sesję...</div>
      </div>
    );
  }

  if (mode === "login") {
    return (
      <div style={pageStyle}>
        <div style={cardStyle}>
          <div style={brandRow}>
            <div style={brandDot} />
            <div style={brandText}>Mapa projektów - BD</div>
          </div>

          <h2 style={titleStyle}>Logowanie</h2>
          <p style={subtitleStyle}>Wpisz login i hasło.</p>

          {authNotice ? (
            <div
              style={{
                boxSizing: "border-box",
                marginTop: 12,
                padding: 12,
                borderRadius: 12,
                background: "rgba(59, 130, 246, 0.16)",
                border: "1px solid rgba(59, 130, 246, 0.35)",
                color: "rgba(255,255,255,0.96)",
              }}
            >
              {authNotice}
            </div>
          ) : null}

          {err ? <div style={errorStyle}>{err}</div> : null}

          <form onSubmit={onLoginSubmit} style={{ marginTop: 14 }}>
            <label style={labelStyle}>Login</label>
            <input
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              placeholder="np. admin@firma.pl"
              autoComplete="username"
              autoFocus
              style={inputStyle}
            />

            <label style={{ ...labelStyle, marginTop: 10 }}>Hasło</label>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              type="password"
              autoComplete="current-password"
              style={inputStyle}
            />

            <button type="submit" disabled={loadingAuth} style={primaryButtonStyle(loadingAuth)}>
              {loadingAuth ? "Loguję..." : "Zaloguj"}
            </button>
          </form>

          <div style={hintStyle}>Konta użytkowników są zakładane przez administratora.</div>
        </div>
      </div>
    );
  }

  /** ===== APP UI ===== */
  const sidebarWidthOpen = 380;
  const sidebarWidthClosed = 0;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "grid",
        gridTemplateColumns: `${sidebarOpen ? sidebarWidthOpen : sidebarWidthClosed}px 1fr`,
        width: "100%",
        height: "100%",
        overflow: "hidden",
      }}
    >
      {/* SIDEBAR */}
      <aside
  style={{
    color: TEXT_LIGHT,
    borderRight: sidebarOpen ? `1px solid ${BORDER}` : "none",
    overflow: "hidden",
    width: sidebarOpen ? sidebarWidthOpen : sidebarWidthClosed,
    transition: "width 200ms ease",
    background: GLASS_BG,
    backgroundImage: GLASS_HIGHLIGHT,
    backdropFilter: "blur(8px)",
    boxShadow: GLASS_SHADOW,
  }}
>
  {sidebarOpen ? (
    <>
      {/* HEADER */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "12px 12px",
          borderBottom: `1px solid ${BORDER}`,
          background: GLASS_BG_DARK,
          backgroundImage: GLASS_HIGHLIGHT,
          backdropFilter: "blur(10px)",
        }}
      >
        <button
          onClick={() => setSidebarOpen(false)}
          title="Zwiń panel"
          style={{
            width: 36,
            height: 36,
            borderRadius: 12,
            border: `1px solid ${BORDER}`,
            background: "rgba(255,255,255,0.06)",
            color: TEXT_LIGHT,
            cursor: "pointer",
            display: "grid",
            placeItems: "center",
            fontSize: 16,
            lineHeight: 1,
            padding: 0,
            boxShadow: "0 10px 22px rgba(0,0,0,0.18)",
          }}
        >
          ⟨
        </button>

        <div style={{ display: "grid", gap: 3, flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <span
              style={{
                fontSize: 10,
                fontWeight: 900,
                letterSpacing: 0.6,
                padding: "3px 8px",
                borderRadius: 999,
                border: `1px solid ${BORDER}`,
                background: "rgba(255,255,255,0.06)",
                color: "rgba(255,255,255,0.88)",
                flexShrink: 0,
              }}
            >
              BD
            </span>

            <div
              style={{
                fontWeight: 900,
                letterSpacing: 0.2,
                fontSize: 14,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              Mapa projektów
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: 999,
                background: "rgba(34,197,94,0.95)",
                boxShadow: "0 0 12px rgba(34,197,94,0.22)",
                flexShrink: 0,
              }}
            />
            <div
              style={{
                fontSize: 11,
                color: MUTED,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              Zalogowano:{" "}
              <b style={{ color: "rgba(255,255,255,0.88)" }}>
                {user?.email || "(użytkownik)"}
              </b>
            </div>
          </div>
        </div>

        <button
          onClick={() => logout()}
          style={{
            padding: "8px 10px",
            borderRadius: 12,
            border: `1px solid ${BORDER}`,
            background: "rgba(255,255,255,0.06)",
            color: TEXT_LIGHT,
            cursor: "pointer",
            fontWeight: 900,
            fontSize: 11,
            boxShadow: "0 10px 22px rgba(0,0,0,0.16)",
          }}
        >
          Wyloguj
        </button>
      </div>

      <div
        style={{
          padding: 10,
          height: "calc(100% - 55px)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {apiError ? (
          <div
            style={{
              padding: 10,
              borderRadius: 14,
              border: "1px solid rgba(255,120,120,0.45)",
              background: "rgba(255,120,120,0.12)",
              color: "rgba(255,255,255,0.95)",
              fontSize: 11,
              marginBottom: 10,
            }}
          >
            {apiError}
          </div>
        ) : null}

        {/* Dodawanie */}
        <div
          style={{
            padding: 10,
            borderRadius: 14,
            border: `1px solid ${BORDER}`,
            background: "rgba(255,255,255,0.04)",
            backgroundImage: GLASS_HIGHLIGHT,
            backdropFilter: "blur(8px)",
            marginBottom: 10,
          }}
        >
          <div style={{ fontWeight: 800, marginBottom: 8, fontSize: 13 }}>Dodawanie projektów</div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <button
              onClick={() => {
                setActiveDrawTool("draw");
                setAddMode((m) => (m === "point" ? "none" : "point"));
              }}
              style={{
                padding: "9px 10px",
                borderRadius: 12,
                border: `1px solid ${BORDER}`,
                background:
                  addMode === "point" ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.08)",
                color: TEXT_LIGHT,
                cursor: "pointer",
                fontWeight: 800,
                fontSize: 12,
              }}
              title="Kliknij mapę, aby dodać punkt"
            >
              🎯 Punkt
            </button>

            <button
              onClick={() => {
                setActiveDrawTool("draw");
                setAddMode((m) => (m === "tunnel" ? "none" : "tunnel"));
              }}
              style={{
                padding: "9px 10px",
                borderRadius: 12,
                border: `1px solid ${BORDER}`,
                background:
                  addMode === "tunnel" ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.08)",
                color: TEXT_LIGHT,
                cursor: "pointer",
                fontWeight: 800,
                fontSize: 12,
              }}
              title="Rysuj linię na mapie"
            >
              🧵 Tunel
            </button>
          </div>

          <div style={{ marginTop: 8, fontSize: 11, color: MUTED, lineHeight: 1.35 }}>
            {addMode === "point"
              ? "Dodawanie: Punkt — kliknij na mapie, żeby dodać marker."
              : addMode === "tunnel"
              ? "Dodawanie: Tunel — użyj narzędzia rysowania linii (klik/klik/klik i zakończ)."
              : "Wybierz tryb dodawania: Punkt albo Tunel."}
          </div>
        </div>

        {/* NARZĘDZIA */}
        <div
          style={{
            padding: 10,
            borderRadius: 14,
            border: `1px solid ${BORDER}`,
            background: "rgba(255,255,255,0.04)",
            backgroundImage: GLASS_HIGHLIGHT,
            backdropFilter: "blur(8px)",
            marginBottom: 10,
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            flex: 1,
          }}
        >
          <div style={{ fontWeight: 800, marginBottom: 8, fontSize: 13 }}>Narzędzia</div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 8,
              marginBottom: 10,
            }}
          >
            <button
              onClick={() => {
                loadPoints();
                loadTunnels();
              }}
              style={{
                width: "100%",
                padding: 9,
                borderRadius: 12,
                border: `1px solid ${BORDER}`,
                background: "rgba(255,255,255,0.08)",
                color: TEXT_LIGHT,
                cursor: "pointer",
                fontWeight: 800,
                fontSize: 12,
              }}
            >
              {loadingPoints || loadingTunnels ? "Ładuję..." : "Odśwież"}
            </button>

            <button
              onClick={() => {
                setSelectedPointId(null);
                setSelectedTunnelId(null);
                try {
                  mapRef.current?.closePopup?.();
                } catch {}
              }}
              style={{
                width: "100%",
                padding: 9,
                borderRadius: 12,
                border: `1px solid ${BORDER}`,
                background: "rgba(255,255,255,0.05)",
                color: TEXT_LIGHT,
                cursor: "pointer",
                fontWeight: 800,
                fontSize: 12,
              }}
            >
              Odznacz
            </button>
          </div>

          {selectedPoint || selectedTunnel ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              <button
                onClick={() => {
                  if (selectedPoint) togglePointPriority(selectedPoint);
                  else toggleTunnelPriority(selectedTunnel);
                }}
                style={{
                  padding: "9px 10px",
                  borderRadius: 12,
                  border: `1px solid ${BORDER}`,
                  background: "rgba(255,255,255,0.08)",
                  cursor: "pointer",
                  fontWeight: 800,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  justifyContent: "center",
                  color: TEXT_LIGHT,
                }}
                title="Oznacz jako ważne"
              >
                <span
                  style={{
                    fontSize: 16,
                    lineHeight: 1,
                    color:
                      selectedPoint?.priority || selectedTunnel?.priority
                        ? "rgba(255,255,255,0.65)"
                        : "rgba(245,158,11,0.95)",
                    textShadow:
                      selectedPoint?.priority || selectedTunnel?.priority
                        ? "none"
                        : "0 0 12px rgba(245,158,11,0.25)",
                  }}
                >
                  ❗
                </span>
                <span style={{ fontSize: 12, whiteSpace: "nowrap" }}>Ważne</span>
              </button>

              <button
                onClick={() => setEditOpen(true)}
                style={{
                  padding: 9,
                  borderRadius: 12,
                  border: `1px solid ${BORDER}`,
                  background: "rgba(255,255,255,0.10)",
                  color: TEXT_LIGHT,
                  cursor: "pointer",
                  fontWeight: 800,
                  fontSize: 12,
                }}
              >
                Edytuj
              </button>

              <button
                onClick={deleteSelectedProject}
                style={{
                  padding: 9,
                  borderRadius: 12,
                  border: "1px solid rgba(255,80,80,0.55)",
                  background: "rgba(255,80,80,0.14)",
                  color: TEXT_LIGHT,
                  cursor: "pointer",
                  fontWeight: 800,
                  fontSize: 12,
                }}
              >
                Usuń
              </button>
            </div>
          ) : null}

          <div style={{ height: 1, background: BORDER, margin: "10px 0" }} />

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              marginBottom: 8,
            }}
          >
            <div style={{ fontWeight: 900 }}>Lista projektów</div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 11,
                color: MUTED,
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 999,
                  border: "1px solid rgba(255,216,77,0.55)",
                  background: "rgba(255,216,77,0.10)",
                  boxShadow: "0 0 10px rgba(255,216,77,0.12)",
                  display: "inline-block",
                }}
              />
              Ważny
            </div>
          </div>

          <input
  className="projectSearch"
  value={projectQuery}
  onChange={(e) => setProjectQuery(e.target.value)}
  placeholder="Szukaj projektu… (wpisz nazwę lub słowo klucz)"
  style={{
    width: "100%",
    boxSizing: "border-box",
    height: 36,
    padding: "0 10px",
    borderRadius: 12,
    border: `1px solid ${BORDER}`,
    background: "rgba(255,255,255,0.06)",
    color: TEXT_LIGHT,
    outline: "none",
    fontSize: 12,
    fontWeight: 700,
    marginBottom: 10,
  }}
/>

          <div style={{ overflow: "auto", paddingRight: 4, flex: 1, minHeight: 0 }}>
            <div style={{ display: "grid", gap: 8 }}>
              {filteredProjectsSearch.map((x) => {
                const isTunnel = x.kind === "tunnel";
                const selected = isTunnel ? x.id === selectedTunnelId : x.id === selectedPointId;

                return (
                  <div
                    key={`${x.kind}-${x.id}`}
                    onClick={() => {
                      if (isTunnel) {
                        setSelectedTunnelId(x.id);
                        setSelectedPointId(null);
                        focusTunnel(x);
                      } else {
                        setSelectedPointId(x.id);
                        setSelectedTunnelId(null);
                        focusPoint(x);
                      }
                    }}
                    style={{
                      padding: 9,
                      borderRadius: 14,
                      border: x.priority
                        ? "2px solid rgba(255,216,77,0.70)"
                        : selected
                        ? "2px solid rgba(255,255,255,0.35)"
                        : `1px solid ${BORDER}`,
                      background: x.priority ? "rgba(255,216,77,0.08)" : "rgba(255,255,255,0.05)",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span
                        style={{
                          width: 14,
                          display: "flex",
                          justifyContent: "center",
                          flexShrink: 0,
                        }}
                      >
                        {isTunnel ? "🟦" : "📍"}
                      </span>

                      <span
                        style={{
                          fontWeight: 800,
                          fontSize: 12,
                          minWidth: 0,
                          overflow: "hidden",
                          display: "-webkit-box",
                          WebkitBoxOrient: "vertical",
                          WebkitLineClamp: 2,
                          lineClamp: 2,
                          whiteSpace: "normal",
                          lineHeight: 1.2,
                        }}
                      >
                        {isTunnel ? x.name || `Tunel #${x.id}` : x.title}
                      </span>

                      <span
                        style={{
                          ...pillStyle,
                          marginLeft: "auto",
                          whiteSpace: "nowrap",
                          flexShrink: 0,
                          fontWeight: 700,
                        }}
                      >
                        {statusLabel(x.status)}
                      </span>
                    </div>
                  </div>
                );
              })}

              {filteredProjectsSearch.length === 0 ? (
                <div style={{ ...emptyBoxStyle, fontSize: 11 }}>
                  Brak danych dla zaznaczonych statusów / wyszukiwania.
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </>
  ) : null}
</aside>

      {/* MAP */}
      <main
        style={{
          width: "100%",
          height: "100%",
          position: "relative",
          cursor: addMode === "point" ? "crosshair" : "default",
        }}
      >
        {!sidebarOpen ? (
          <button
            onClick={() => setSidebarOpen(true)}
            title="Pokaż panel"
            style={{
              position: "absolute",
              zIndex: 1500,
              top: 12,
              left: 12,
              height: 44,
              padding: "0 12px",
              borderRadius: 14,
              border: `1px solid ${BORDER}`,
              background: GLASS_BG_DARK,
              color: TEXT_LIGHT,
              cursor: "pointer",
              fontWeight: 800,
              display: "flex",
              alignItems: "center",
              gap: 10,
              boxShadow: "0 6px 18px rgba(0,0,0,0.25)",
              backdropFilter: "blur(8px)",
            }}
          >
            <span style={{ fontSize: 18, lineHeight: 1 }}>⟩</span>
            <span style={{ fontSize: 13 }}>Panel główny</span>
          </button>
        ) : null}

        {/* ===== górna zakładka narzędzi (tylko w addMode) ===== */}
        {addMode !== "none" ? (
          <div
            style={{
              position: "absolute",
              top: 12,
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 1800,
              width: "min(520px, calc(100% - 420px))",
              maxWidth: "52vw",
              borderRadius: 16,
              border: `1px solid ${BORDER}`,
              background: GLASS_BG,
              backgroundImage:
                "radial-gradient(700px 420px at 20% 10%, rgba(255,255,255,0.10), transparent 60%)",
              color: TEXT_LIGHT,
              boxShadow: GLASS_SHADOW,
              overflow: "hidden",
              backdropFilter: "blur(8px)",
            }}
          >
            <div
              style={{
                padding: "10px 12px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                fontWeight: 900,
                background: "rgba(0,0,0,0.10)",
              }}
            >
              <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ whiteSpace: "nowrap" }}>
                    {addMode === "point" ? "Tryb: Punkt" : "Tryb: Tunel"}
                  </span>
                  <span style={{ fontSize: 11, color: MUTED, fontWeight: 800, opacity: 0.9 }}>
                    {addMode === "point"
                      ? "Kliknij na mapie, aby dodać marker."
                      : "Narysuj linię na mapie (klik/klik/klik i zakończ)."}
                  </span>
                </div>

                {addMode === "tunnel" && drawReady ? (
                  <div
                    style={{
                      paddingTop: 10,
                      display: "flex",
                      gap: 8,
                      alignItems: "center",
                    }}
                  >
                    <button
                      title="Rysuj tunel"
                      onClick={() => {
                        setActiveDrawTool("draw");
                        editToolRef.current?.disable?.();
                        deleteToolRef.current?.disable?.();
                        drawPolylineRef.current?.enable?.();
                      }}
                      style={toolBtnStyle(activeDrawTool === "draw")}
                    >
                      ━
                    </button>

                    <button
                      title="Edytuj geometrię"
                      onClick={() => {
                        setActiveDrawTool("edit");
                        drawPolylineRef.current?.disable?.();
                        deleteToolRef.current?.disable?.();
                        editToolRef.current?.enable?.();
                      }}
                      style={toolBtnStyle(activeDrawTool === "edit")}
                    >
                      ✏️
                    </button>

                    <button
                      title="Usuń tunel"
                      onClick={() => {
                        setActiveDrawTool("delete");
                        drawPolylineRef.current?.disable?.();
                        editToolRef.current?.disable?.();
                        deleteToolRef.current?.enable?.();
                      }}
                      style={{
                        ...toolBtnStyle(activeDrawTool === "delete"),
                        color: "#f87171",
                      }}
                    >
                      🗑️
                    </button>
                  </div>
                ) : null}

                <div style={{ fontSize: 11, color: MUTED, fontWeight: 700, opacity: 0.85 }}>
                  {addMode === "point"
                    ? "Po dodaniu punktu tryb wyłączy się automatycznie."
                    : "Po zapisaniu tunelu tryb wyłączy się automatycznie."}
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                <button
                  onClick={() => {
                    setActiveDrawTool("draw");
                    setAddMode(addMode === "point" ? "tunnel" : "point");
                  }}
                  style={{
                    padding: "9px 10px",
                    borderRadius: 12,
                    border: `1px solid ${BORDER}`,
                    background: "rgba(255,255,255,0.06)",
                    color: TEXT_LIGHT,
                    cursor: "pointer",
                    fontWeight: 900,
                    fontSize: 12,
                  }}
                  title="Przełącz tryb"
                >
                  {addMode === "point" ? "Tunel" : "Punkt"}
                </button>

                <button
                  onClick={() => {
                    try {
                      drawPolylineRef.current?.disable?.();
                      editToolRef.current?.disable?.();
                      deleteToolRef.current?.disable?.();
                    } catch {}
                    setActiveDrawTool("draw");
                    setAddMode("none");
                  }}
                  style={{
                    padding: "9px 10px",
                    borderRadius: 12,
                    border: `1px solid ${BORDER}`,
                    background: "rgba(255,255,255,0.06)",
                    color: TEXT_LIGHT,
                    cursor: "pointer",
                    fontWeight: 900,
                    fontSize: 12,
                  }}
                  title="Wyjdź z trybu dodawania"
                >
                  Zakończ
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <RecentUpdatesPanel
          user={user}
          authFetch={authFetch}
          API={API}
          BORDER={BORDER}
          MUTED={MUTED}
          TEXT_LIGHT={TEXT_LIGHT}
          GLASS_BG={GLASS_BG}
          GLASS_SHADOW={GLASS_SHADOW}
          onUnauthorized={() => logout("expired")}
          onJumpToProject={jumpToProject}
          updatesTick={updatesTick}
        />

        {/* PRAWA STRONA: Statusy + Dziennik */}
        <div
          style={{
            position: "absolute",
            zIndex: 1600,
            top: 12,
            right: 12,
            width: 360,
            display: "grid",
            gap: 10,
          }}
        >
          {/* STATUSY */}
          <div
            style={{
              borderRadius: 16,
              border: `1px solid ${BORDER}`,
              background: GLASS_BG,
              backgroundImage:
                "radial-gradient(500px 300px at 20% 10%, rgba(255,255,255,0.10), transparent 60%)",
              backdropFilter: "blur(8px)",
              color: TEXT_LIGHT,
              overflow: "hidden",
              boxShadow: GLASS_SHADOW,
            }}
          >
            <div
              onClick={() => setFiltersOpen((o) => !o)}
              style={{
                padding: "10px 12px",
                cursor: "pointer",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                fontWeight: 900,
              }}
            >
              <span>Statusy</span>
              <span style={{ fontSize: 12, color: MUTED }}>
                {filteredPoints.length + filteredTunnels.length}/{points.length + tunnels.length}{" "}
                {filtersOpen ? "▾" : "▸"}
              </span>
            </div>

            {filtersOpen ? (
              <div style={{ padding: "8px 12px 12px", display: "grid", gap: 10 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {STATUSES.map((s) => (
                    <label
                      key={s.key}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        cursor: "pointer",
                        opacity: visibleStatus[s.key] ? 1 : 0.55,
                        userSelect: "none",
                        padding: "8px 10px",
                        borderRadius: 12,
                        border: `1px solid ${BORDER}`,
                        background: "rgba(255,255,255,0.04)",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={visibleStatus[s.key]}
                        onChange={() => toggleStatus(s.key)}
                        style={{ transform: "scale(0.95)" }}
                      />
                      <span
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: 999,
                          background: s.color,
                          flexShrink: 0,
                        }}
                      />
                      <span style={{ fontWeight: 800, fontSize: 12, lineHeight: 1.1 }}>
                        {s.label}
                      </span>
                      <span style={{ marginLeft: "auto", fontSize: 12, color: MUTED }}>
                        {counts[s.key] ?? 0}
                      </span>
                    </label>
                  ))}
                </div>

                <div style={{ display: "flex", gap: 8, marginTop: 2 }}>
                  <button
                    onClick={showAllStatuses}
                    style={{
                      padding: "8px 10px",
                      borderRadius: 10,
                      border: `1px solid ${BORDER}`,
                      background: "rgba(255,255,255,0.08)",
                      color: TEXT_LIGHT,
                      cursor: "pointer",
                      fontWeight: 800,
                      fontSize: 12,
                      lineHeight: 1,
                    }}
                  >
                    Pokaż wszystko
                  </button>

                  <button
                    onClick={hideAllStatuses}
                    style={{
                      padding: "8px 10px",
                      borderRadius: 10,
                      border: `1px solid ${BORDER}`,
                      background: "rgba(255,255,255,0.05)",
                      color: TEXT_LIGHT,
                      cursor: "pointer",
                      fontWeight: 800,
                      fontSize: 12,
                      lineHeight: 1,
                    }}
                  >
                    Ukryj wszystko
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          {/* DZIENNIK */}
          <JournalPanel
            visible={!!selectedPoint || !!selectedTunnel}
            kind={selectedPoint ? "points" : "tunnels"}
            entity={selectedPoint || selectedTunnel}
            user={user}
            authFetch={authFetch}
            API={API}
            BORDER={BORDER}
            MUTED={MUTED}
            TEXT_LIGHT={TEXT_LIGHT}
            GLASS_BG={GLASS_BG}
            GLASS_SHADOW={GLASS_SHADOW}
            onCountsChange={handleCountsChange}
            onUnauthorized={() => logout("expired")}
            onGlobalUpdatesChange={bumpUpdates}
          />
        </div>

        <MapContainer
          bounds={POLAND_BOUNDS}
          boundsOptions={{ padding: [20, 20] }}
          style={{ width: "100%", height: "100%" }}
          zoomControl={false}
          minZoom={3}
        >
          <MapAutoDeselect
            enabled={addMode === "none" || addMode === ""}
            mapRef={mapRef}
            suppressRef={suppressNextMapClickRef}
            onDeselect={() => {
              setSelectedTunnelId(null);
              setSelectedPointId(null);
              setEditOpen(false);
            }}
          />

          <MapRefSetter onReady={(map) => (mapRef.current = map)} />

          <ZoomControl position="bottomright" />
          <TileLayer
            attribution="&copy; OpenStreetMap contributors"
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          {worldMask ? (
            <GeoJSON
              data={worldMask}
              style={{
                fillColor: "#0f172a",
                fillOpacity: 0.55,
                color: "#0f172a",
                weight: 0,
              }}
            />
          ) : null}

          <ClickHandler enabled={addMode === "point"} onAdd={addPoint} />

          <FeatureGroup ref={drawGroupRef}>
            {/* TUNELE */}
            {filteredTunnels.map((t) => (
              <Polyline
                ref={(ref) => {
                  if (ref) tunnelRefs.current[t.id] = ref;
                }}
                key={`tl-${t.id}`}
                positions={(t.path || []).map((p) => [Number(p.lat), Number(p.lng)])}
                pathOptions={{
                  color: tunnelColor(t.status),
                  weight: 10,
                  opacity: 0.95,
                  lineCap: "round",
                  lineJoin: "round",
                  tunnelId: t.id,
                  bubblingMouseEvents: false,
                }}
                eventHandlers={{
                  click: (e) => {
                    suppressNextMapClickRef.current = true;
                    setTimeout(() => (suppressNextMapClickRef.current = false), 0);

                    setSelectedTunnelId(t.id);
                    setSelectedPointId(null);
                    try {
                      e?.target?.openPopup?.();
                    } catch {}
                  },
                }}
              >
                <Popup closeButton={false} className="tmPopup">
                  <div
                    style={{
                      minWidth: 260,
                      borderRadius: 16,
                      border: `1px solid ${BORDER}`,
                      background: GLASS_BG,
                      backgroundImage:
                        "radial-gradient(520px 320px at 20% 10%, rgba(255,255,255,0.10), transparent 60%)",
                      color: TEXT_LIGHT,
                      boxShadow: GLASS_SHADOW,
                      padding: 12,
                      position: "relative",
                      backdropFilter: "blur(8px)",
                    }}
                  >
                    <button
                      onClick={() => mapRef.current?.closePopup?.()}
                      title="Zamknij"
                      style={{
                        position: "absolute",
                        top: 8,
                        right: 8,
                        width: 26,
                        height: 26,
                        borderRadius: 8,
                        border: `1px solid ${BORDER}`,
                        background: "rgba(255,255,255,0.06)",
                        color: "rgba(255,255,255,0.85)",
                        cursor: "pointer",
                        display: "grid",
                        placeItems: "center",
                        padding: 0,
                      }}
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        <path
                          d="M6 6l12 12M18 6l-12 12"
                          stroke="currentColor"
                          strokeWidth="2.4"
                          strokeLinecap="round"
                        />
                      </svg>
                    </button>

                    <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 900, marginBottom: 4, lineHeight: 1.15 }}>
                          {t.name || `Tunel #${t.id}`}
                        </div>

                        <div style={{ fontSize: 12, color: MUTED }}>
                          Status:{" "}
                          <b style={{ color: "rgba(255,255,255,0.92)" }}>
                            {statusLabel(t.status)}
                          </b>
                        </div>
                      </div>

                      <div style={{ marginRight: 34, flexShrink: 0 }}>
                        <ChanceRing
                          value={projectChance({
                            acquired: isAcquired("tunnels", t.id),
                            journalCount: journalCounts.tunnels?.[t.id] || 0,
                          })}
                        />
                      </div>
                    </div>

                    <div style={{ height: 1, background: BORDER, margin: "10px 0" }} />

                    {t.winner && (
                      <div style={{ fontSize: 12, marginBottom: 6 }}>
                        <b>Firma:</b> {t.winner}
                      </div>
                    )}

                    <div style={{ fontSize: 12, opacity: 0.9 }}>
                      {t.note || <span style={{ opacity: 0.65 }}>Brak notatki</span>}
                    </div>

                    <div style={{ fontSize: 11, color: MUTED, marginTop: 8 }}>
                      Wpisy w dzienniku: {journalCounts.tunnels?.[t.id] || 0}
                    </div>

                    <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
                      <button
                        onClick={() => setEditOpen(true)}
                        style={{
                          padding: "6px 10px",
                          borderRadius: 10,
                          border: `1px solid ${BORDER}`,
                          background: "rgba(255,255,255,0.06)",
                          color: TEXT_LIGHT,
                          fontWeight: 800,
                          fontSize: 11,
                          cursor: "pointer",
                        }}
                      >
                        Rozwiń
                      </button>
                    </div>
                  </div>
                </Popup>
              </Polyline>
            ))}

            {/* PUNKTY */}
            {filteredPoints.map((pt) => (
              <Marker
                key={`pt-${pt.id}`}
                position={[Number(pt.lat), Number(pt.lng)]}
                icon={pinIcons[pt.status || "planowany"]}
                bubblingMouseEvents={false}
                ref={(ref) => {
                  if (ref) markerRefs.current[pt.id] = ref;
                }}
                eventHandlers={{
                  click: (e) => {
                    suppressNextMapClickRef.current = true;
                    setTimeout(() => (suppressNextMapClickRef.current = false), 0);

                    setSelectedPointId(pt.id);
                    setSelectedTunnelId(null);
                    try {
                      e?.target?.openPopup?.();
                    } catch {}
                  },
                }}
              >
                <Popup closeButton={false} className="tmPopup">
                  <div
                    style={{
                      minWidth: 260,
                      borderRadius: 16,
                      border: `1px solid ${BORDER}`,
                      background: GLASS_BG,
                      backgroundImage:
                        "radial-gradient(520px 320px at 20% 10%, rgba(255,255,255,0.10), transparent 60%)",
                      color: TEXT_LIGHT,
                      boxShadow: GLASS_SHADOW,
                      padding: 12,
                      position: "relative",
                      backdropFilter: "blur(8px)",
                    }}
                  >
                    <button
                      onClick={() => mapRef.current?.closePopup?.()}
                      title="Zamknij"
                      style={{
                        position: "absolute",
                        top: 8,
                        right: 8,
                        width: 26,
                        height: 26,
                        borderRadius: 8,
                        border: `1px solid ${BORDER}`,
                        background: "rgba(255,255,255,0.06)",
                        color: "rgba(255,255,255,0.85)",
                        cursor: "pointer",
                        display: "grid",
                        placeItems: "center",
                        padding: 0,
                      }}
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        <path
                          d="M6 6l12 12M18 6l-12 12"
                          stroke="currentColor"
                          strokeWidth="2.4"
                          strokeLinecap="round"
                        />
                      </svg>
                    </button>

                    <div style={{ display: "flex", gap: 12 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 900, marginBottom: 4, lineHeight: 1.15 }}>
                          {pt.title}
                        </div>
                        <div style={{ fontSize: 12, color: MUTED }}>
                          Status:{" "}
                          <b style={{ color: "rgba(255,255,255,0.92)" }}>
                            {statusLabel(pt.status)}
                          </b>
                        </div>
                      </div>

                      <div style={{ marginRight: 34, flexShrink: 0 }}>
                        <ChanceRing
                          value={projectChance({
                            acquired: isAcquired("points", pt.id),
                            journalCount: journalCounts.points?.[pt.id] || 0,
                          })}
                        />
                      </div>
                    </div>

                    <div style={{ height: 1, background: BORDER, margin: "10px 0" }} />

                    {pt.winner && (
                      <div style={{ fontSize: 12 }}>
                        <b>Firma:</b> {pt.winner}
                      </div>
                    )}

                    <div style={{ fontSize: 12, opacity: 0.9, marginTop: 6 }}>
                      {pt.note || <span style={{ opacity: 0.65 }}>Brak notatki</span>}
                    </div>

                    <div style={{ fontSize: 11, color: MUTED, marginTop: 8 }}>
                      Wpisy w dzienniku: {journalCounts.points?.[pt.id] || 0}
                    </div>

                    <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
                      <button
                        onClick={() => setEditOpen(true)}
                        style={{
                          padding: "6px 10px",
                          borderRadius: 10,
                          border: `1px solid ${BORDER}`,
                          background: "rgba(255,255,255,0.06)",
                          color: TEXT_LIGHT,
                          fontWeight: 800,
                          fontSize: 11,
                          cursor: "pointer",
                        }}
                      >
                        Rozwiń
                      </button>
                    </div>
                  </div>
                </Popup>
              </Marker>
            ))}
          </FeatureGroup>
        </MapContainer>

        <EditProjectModal
          open={editOpen}
          kind={selectedPoint ? "points" : "tunnels"}
          entity={
            selectedPoint
              ? { ...selectedPoint, acquired: isAcquired("points", selectedPoint.id) }
              : selectedTunnel
              ? { ...selectedTunnel, acquired: isAcquired("tunnels", selectedTunnel.id) }
              : null
          }
          onClose={() => setEditOpen(false)}
          onSave={saveEditedProject}
          BORDER={BORDER}
          TEXT_LIGHT={TEXT_LIGHT}
          MUTED={MUTED}
          GLASS_BG={GLASS_BG_DARK}
        />
      </main>
    </div>
  );
}

/** ===== small styles ===== */
const emptyBoxStyle = {
  padding: 12,
  borderRadius: 14,
  border: `1px dashed ${BORDER}`,
  color: MUTED,
};

const pillStyle = {
  fontSize: 11,
  padding: "2px 8px",
  borderRadius: 999,
  background: "rgba(255,255,255,0.10)",
  border: `1px solid ${BORDER}`,
  color: "rgba(255,255,255,0.9)",
  whiteSpace: "nowrap",
};

/** ===== Login styles ===== */
const pageStyle = {
  position: "fixed",
  inset: 0,
  minHeight: "100vh",
  width: "100%",
  display: "grid",
  placeItems: "center",
  padding: "clamp(12px, 3vw, 24px)",
  overflow: "hidden",
  overflowX: "hidden",
  background:
    "radial-gradient(1200px 600px at 20% 10%, rgba(99,102,241,0.22), transparent 60%)," +
    "radial-gradient(900px 500px at 85% 20%, rgba(34,197,94,0.14), transparent 55%)," +
    "radial-gradient(900px 500px at 40% 95%, rgba(59,130,246,0.16), transparent 55%)," +
    "linear-gradient(180deg, #070B14 0%, #0B1220 45%, #070B14 100%)",
};

const cardStyle = {
  boxSizing: "border-box",
  width: "min(420px, calc(100% - 32px))",
  maxWidth: 520,
  background: "rgba(18, 32, 51, 0.72)",
  borderRadius: 18,
  padding: "clamp(16px, 2.2vw, 22px)",
  boxShadow: "0 18px 55px rgba(0,0,0,0.45)",
  border: "1px solid rgba(255,255,255,0.10)",
  backdropFilter: "blur(10px)",
};

const brandRow = {
  display: "flex",
  alignItems: "center",
  gap: 10,
};

const brandDot = {
  width: 10,
  height: 10,
  borderRadius: 999,
  background: "rgba(255,255,255,0.85)",
  boxShadow: "0 0 0 6px rgba(255,255,255,0.08)",
  flex: "0 0 auto",
};

const brandText = {
  color: "white",
  fontWeight: 800,
  letterSpacing: 0.2,
  fontSize: 14,
};

const titleStyle = {
  margin: "10px 0 0",
  fontSize: 22,
  color: "white",
  textAlign: "center",
};

const subtitleStyle = {
  marginTop: 8,
  opacity: 0.82,
  color: "white",
  textAlign: "center",
};

const labelStyle = {
  display: "block",
  color: "rgba(255,255,255,0.85)",
  fontSize: 12,
  fontWeight: 700,
  marginBottom: 6,
};

const inputStyle = {
  boxSizing: "border-box",
  width: "100%",
  height: 40,
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(255,255,255,0.06)",
  color: "white",
  padding: "0 12px",
  outline: "none",
};

const errorStyle = {
  boxSizing: "border-box",
  marginTop: 12,
  padding: 12,
  borderRadius: 12,
  background: "rgba(255, 59, 59, 0.16)",
  border: "1px solid rgba(255, 59, 59, 0.40)",
  color: "rgba(255,255,255,0.96)",
};

const primaryButtonStyle = (loading) => ({
  boxSizing: "border-box",
  marginTop: 14,
  width: "100%",
  height: 40,
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(255,255,255,0.10)",
  color: "white",
  fontWeight: 800,
  cursor: loading ? "not-allowed" : "pointer",
});

const hintStyle = {
  marginTop: 12,
  opacity: 0.78,
  fontSize: 13,
  color: "white",
  textAlign: "center",
};