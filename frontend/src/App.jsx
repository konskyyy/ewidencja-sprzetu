import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { API_BASE, getToken, loginRequest, meRequest, setToken } from "./api";

import "leaflet/dist/leaflet.css";
import L from "leaflet";

import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  useMapEvents,
  useMap,
  ZoomControl,
  GeoJSON,
} from "react-leaflet";

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

const DEVICE_TYPES = [
  { value: "tachimetr", label: "Tachimetr" },
  { value: "pochylomierz", label: "Pochyłomierz" },
  { value: "czujnik_drgan", label: "Czujnik drgań" },
  { value: "inklinometr", label: "Inklinometr" },
];
const WAREHOUSES = [
  { value: "GEO_BB", label: "GEO BB" },
  { value: "GEO_OM", label: "GEO OM" },
  { value: "GEO_LD", label: "GEO LD" },
];

// jeden „source of truth” kolorów
const DEVICE_COLORS = {
  tachimetr: "#3b82f6",      // niebieski
  pochylomierz: "#22c55e",   // zielony
  czujnik_drgan: "#f59e0b",  // pomarańczowy
  inklinometr: "#a855f7",    // fiolet
};

function typeLabel(v) {
  return DEVICE_TYPES.find((t) => t.value === v)?.label || "Inne";
}

function typeColor(v) {
  return DEVICE_COLORS[v] || "#9ca3af"; // fallback szary
}

function StorageOverlay({
  open,
  onToggle,
  storageDevices,
  storageByWarehouse,
  filteredStorageSearch,
  selectedPointId,
  setSelectedPointId,
  setEditOpen,
  onOpenWarehouse,
  BORDER,
  MUTED,
  GLASS_BG,
  GLASS_SHADOW,
}) {
  return (
    <div
      style={{
        position: "absolute",
        top: 12,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 1700,
        width: "min(560px, calc(100% - 420px))",
        maxWidth: "52vw",
        borderRadius: 16,
        border: `1px solid ${BORDER}`,
        background: GLASS_BG,
        boxShadow: GLASS_SHADOW,
        backdropFilter: "blur(8px)",
        overflow: "hidden",
      }}
    >
      {/* HEADER — ZAWSZE WIDOCZNY */}
      <div
        onClick={onToggle}
        style={{
          padding: "10px 12px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          cursor: "pointer",
          fontWeight: 900,
          background: "rgba(0,0,0,0.12)",
        }}
      >
        <span>Magazyny</span>
        <span style={{ fontSize: 12, color: MUTED }}>
          {storageDevices?.length || 0} {open ? "▾" : "▸"}
        </span>
      </div>

      {/* BODY — TYLKO TO JEST ZWIJANE */}
      {open && (
        <div style={{ padding: 12, display: "grid", gap: 10 }}>
          {/* kafelki magazynów */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
  {Object.entries(storageByWarehouse).map(([key, list]) => (
    <button
      type="button"
      key={key}
      onClick={(e) => {
        e.stopPropagation();
        onOpenWarehouse?.(key);
      }}
      style={{
        all: "unset",
        cursor: "pointer",
        padding: "8px 10px",
        borderRadius: 12,
        border: `1px solid ${BORDER}`,
        background: "rgba(255,255,255,0.05)",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}
      title="Kliknij, aby otworzyć listę urządzeń"
    >
      <span style={{ fontWeight: 800, fontSize: 12 }}>📦 {key}</span>
      <span style={{ fontSize: 12, color: MUTED, fontWeight: 900 }}>{list.length}</span>
    </button>
  ))}
</div>

          {filteredStorageSearch.length === 0 && (
            <div style={{ fontSize: 11, color: MUTED }}>
              Brak urządzeń w magazynie (lub brak wyników).
            </div>
          )}
        </div>
      )}
    </div>
  );
}


// Natural Earth (GeoJSON) – granice państw
const NE_COUNTRIES_URL =
  "https://d2ad6b4ur7yvpq.cloudfront.net/naturalearth-3.3.0/ne_50m_admin_0_countries.geojson";
const KEEP_COUNTRIES_A3 = new Set(["POL", "LTU", "LVA", "EST"]);

function ClickHandler({ enabled, onPick }) {
  useMapEvents({
   click(e) {
  if (!enabled) return;

  // jeśli właśnie przeciągałeś mapę, nie dodawaj punktu przypadkiem
  if (e?.originalEvent?.defaultPrevented) return;

  onPick?.(e.latlng);
},
  });
  return null;
}

function statusLabel(v) {
  return typeLabel(v);
}

function statusColor(status) {
  if (status === "tachimetr") return "#3b82f6";
  if (status === "pochylomierz") return "#22c55e";
  if (status === "czujnik_drgan") return "#f59e0b";
  if (status === "inklinometr") return "#a855f7";
  return "#9ca3af";
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
function toBool(v) {
  return v === true || v === 1 || v === "1" || v === "true";
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
  if (v >= 80) return "rgba(34,197,94,0.95)";
  if (v >= 60) return "rgba(245,158,11,0.95)";
  return "rgba(239,68,68,0.95)";
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
        Zużycie
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
  return Math.min(90, 50 + Math.min(4, n) * 10);
}

function deviceChance({ acquired, journalCount }) {
  if (acquired) return 100;
  return chanceFromJournalCount(journalCount);
}

/** ===== JOURNAL ===== */
function JournalPanel({
  visible,
  kind, // "points"
  entity, // selectedDevice
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
  onGlobalUpdatesChange,
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

  const openKey = entityId ? `journalOpen:${kind}:${entityId}` : null;

  function readOpenFromStorage() {
    if (!openKey) return true;
    try {
      const raw = localStorage.getItem(openKey);
      if (raw === null) return true;
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

  const title = `Dziennik: ${entity?.title || `#${entityId}`}`;

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
                Brak aktywności w ostatnim czasie dla tego urządzenia.
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
              <div style={sectionHintStyle}>Pełna historia urządzenia.</div>
            </div>

            {items.length === 0 ? (
              <div style={{ fontSize: 12, color: MUTED }}>Brak wpisów dla tego urządzenia.</div>
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

  setItems([]);
  setExpanded({});

  try {
    const res = await authFetch(`${API}/updates/read-all?limit=500`, {
      method: "POST",
    });
    await readJsonOrThrow(res);
    setOpen(false);
  } catch (e) {
    if (e?.status === 401) return onUnauthorized?.();
    setErr(String(e?.message || e));
    load();
  }
}

async function markRead(u) {
  const itemKey = `${u.kind}:${u.entity_id}:${u.id}`;

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
function EditDeviceModal({
  open,
  device,
  onClose,
  onSave,
  BORDER,
  TEXT_LIGHT,
  MUTED,
  GLASS_BG,
}) {
  function normalizeDeviceType(v) {
    const s = String(v || "").trim().toLowerCase();

    // nowe typy
    if (s === "tachimetr") return "tachimetr";
    if (s === "pochylomierz") return "pochylomierz";
    if (s === "czujnik_drgan") return "czujnik_drgan";
    if (s === "inklinometr") return "inklinometr";

    // stare statusy -> domyślny nowy typ
    if (s === "planowany" || s === "przetarg" || s === "realizacja" || s === "nieaktualny") {
      return "tachimetr";
    }

    return "tachimetr";
  }

  const [form, setForm] = useState({
    title: "",
    status: "tachimetr",
    note: "",
    in_storage: false,
    warehouse: "GEO_BB",
  });

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open || !device) return;

    setErr("");
    setSaving(false);

    setForm({
      title: device.title ?? "",
      status: normalizeDeviceType(device.status),
      note: device.note ?? "",
      in_storage: device.in_storage === true,
      warehouse: device.warehouse ?? "GEO_BB",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, device]);

  if (!open || !device) return null;

  const title = `Edycja urządzenia: ${device.title || `#${device.id}`}`;

async function handleSave() {
  setErr("");

  const payload = {
    title: form.title,
    status: form.status,
    note: form.note,
    in_storage: !!form.in_storage,
    warehouse: form.in_storage ? (form.warehouse || "GEO_BB") : null,
  };

  if (!payload.title.trim()) {
    setErr("Nazwa urządzenia nie może być pusta.");
    return;

  }
  if (!payload.in_storage) {
  // urządzenie musi mieć współrzędne, ale modal ich nie zbiera
  // więc co najmniej wymuś, że device już je ma
  if (!Number.isFinite(Number(device?.lat)) || !Number.isFinite(Number(device?.lng))) {
    setErr("To urządzenie nie ma współrzędnych. Aby zdjąć z magazynu, ustaw je na mapie (dodaj lat/lng).");
    return;
  }
}


  const allowed = new Set(DEVICE_TYPES.map((x) => x.value));
  if (!allowed.has(payload.status)) {
    setErr("Wybierz poprawny rodzaj urządzenia.");
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
              Dostosuj dane urządzenia i zapisz zmiany.
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

          <label style={labelStyleLocal}>Nazwa urządzenia</label>
          <input
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            style={inputStyleLocal}
          />

          <label style={labelStyleLocal}>Rodzaj urządzenia</label>
          <select
            value={form.status}
            onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
            style={inputStyleLocal}
          >
            {DEVICE_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>

          <label style={labelStyleLocal}>Opis urządzenia</label>
          <textarea
            value={form.note}
            onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
            style={textareaStyleLocal}
          />

          {/* MAGAZYN */}
          <label style={{ ...labelStyleLocal, display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={!!form.in_storage}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  in_storage: e.target.checked,
                  warehouse: e.target.checked ? f.warehouse || "GEO_BB" : null,
                }))
              }
            />
            Urządzenie na magazynie (brak współrzędnych)
          </label>

          {form.in_storage ? (
            <>
              <label style={labelStyleLocal}>Magazyn</label>
              <select
                value={form.warehouse || "GEO_BB"}
                onChange={(e) => setForm((f) => ({ ...f, warehouse: e.target.value }))}
                style={inputStyleLocal}
              >
                {WAREHOUSES.map((w) => (
                  <option key={w.value} value={w.value}>
                    {w.label}
                  </option>
                ))}
              </select>
            </>
          ) : null}

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
<WarehouseDevicesModal
  open={warehouseModalOpen}
  warehouseKey={activeWarehouse}
  items={activeWarehouse ? (storageByWarehouse?.[activeWarehouse] || []) : []}
  onClose={() => setWarehouseModalOpen(false)}
  onPickDevice={(d) => {
    setSelectedPointId(d.id);
    setEditOpen(true); // magazynowe -> otwieramy edycję
    setWarehouseModalOpen(false);
  }}
  BORDER={BORDER}
  MUTED={MUTED}
  TEXT_LIGHT={TEXT_LIGHT}
  GLASS_BG={GLASS_BG_DARK}
  GLASS_SHADOW={GLASS_SHADOW}
/>
function useLockBodyScroll(locked) {
  useEffect(() => {
    if (!locked) return;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [locked]);
}

function useEscapeToClose(open, onClose) {
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e) => {
      if (e.key === "Escape") onClose?.();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);
}

function WarehouseDevicesModal({
  open,
  warehouseKey,
  items,
  onClose,
  onPickDevice, // (device) => void
  BORDER,
  MUTED,
  TEXT_LIGHT,
  GLASS_BG,
  GLASS_SHADOW,
  DEVICE_TYPES, // ✅ dodane: nie polegamy na globalu
}) {
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");

  useLockBodyScroll(open);
  useEscapeToClose(open, onClose);

  useEffect(() => {
    if (!open) return;
    setQ("");
    setTypeFilter("all");
  }, [open, warehouseKey]);

  const filtered = useMemo(() => {
    const query = String(q || "").trim().toLowerCase();

    return (Array.isArray(items) ? items : []).filter((p) => {
      if (typeFilter !== "all" && String(p?.status) !== String(typeFilter)) return false;
      if (!query) return true;

      const title = String(p?.title || "").toLowerCase();
      const note = String(p?.note || "").toLowerCase();
      const id = String(p?.id ?? "");
      return title.includes(query) || note.includes(query) || id.includes(query);
    });
  }, [items, q, typeFilter]);

  if (!open) return null;

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
    width: "min(980px, calc(100% - 24px))",
    maxHeight: "min(78vh, 720px)",
    borderRadius: 18,
    border: `1px solid ${BORDER}`,
    background: GLASS_BG,
    backgroundImage:
      "radial-gradient(700px 420px at 20% 10%, rgba(255,255,255,0.10), transparent 60%)",
    boxShadow: GLASS_SHADOW,
    backdropFilter: "blur(10px)",
    overflow: "hidden",
    color: TEXT_LIGHT,
    display: "grid",
    gridTemplateRows: "auto auto 1fr",
  };

  const headerStyle = {
    padding: "12px 12px",
    borderBottom: `1px solid ${BORDER}`,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
    fontWeight: 900,
    background: "rgba(0,0,0,0.10)",
  };

  const controlsStyle = {
    padding: 12,
    borderBottom: `1px solid ${BORDER}`,
    display: "grid",
    gridTemplateColumns: "1fr 220px",
    gap: 10,
    alignItems: "center",
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

  const btnStyle = {
    padding: "8px 10px",
    borderRadius: 12,
    border: `1px solid ${BORDER}`,
    background: "rgba(255,255,255,0.06)",
    color: TEXT_LIGHT,
    cursor: "pointer",
    fontWeight: 900,
    fontSize: 12,
  };

  const tableWrapStyle = { padding: 12, overflow: "auto" };

  const thStyle = {
    textAlign: "left",
    fontSize: 11,
    color: MUTED,
    fontWeight: 900,
    padding: "10px 10px",
    borderBottom: `1px solid ${BORDER}`,
    background: "rgba(255,255,255,0.03)",
    position: "sticky",
    top: 0,
    zIndex: 2,
  };

  const tdStyle = {
    padding: "10px 10px",
    borderBottom: `1px solid ${BORDER}`,
    fontSize: 12,
    verticalAlign: "top",
  };

  const safeDeviceTypes = Array.isArray(DEVICE_TYPES) ? DEVICE_TYPES : [];

  return (
    <div
      style={overlayStyle}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        style={modalStyle}
        onMouseDown={(e) => {
          // ✅ klik wewnątrz nie zamyka
          e.stopPropagation();
        }}
      >
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
              Magazyn: {warehouseKey || "(nieznany)"}
            </div>
            <div style={{ fontSize: 11, color: MUTED, opacity: 0.9, marginTop: 2 }}>
              {filtered.length} / {Array.isArray(items) ? items.length : 0} urządzeń
            </div>
          </div>

          <button onClick={onClose} style={btnStyle} type="button">
            Zamknij
          </button>
        </div>

        <div style={controlsStyle}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filtruj po nazwie, notatce lub ID…"
            style={inputStyleLocal}
          />

          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            style={inputStyleLocal}
          >
            <option value="all">Wszystkie rodzaje</option>
            {safeDeviceTypes.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        <div style={tableWrapStyle}>
          <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
            <thead>
              <tr>
                <th style={{ ...thStyle, width: 90 }}>ID</th>
                <th style={{ ...thStyle, width: 280 }}>Nazwa</th>
                <th style={{ ...thStyle, width: 160 }}>Rodzaj</th>
                <th style={thStyle}>Notatka</th>
                <th style={{ ...thStyle, width: 140 }} />
              </tr>
            </thead>

            <tbody>
              {filtered.map((d) => (
                <tr key={`wh-${warehouseKey}-${d.id}`}>
                  <td style={tdStyle}>#{d.id}</td>

                  <td style={tdStyle}>
                    <div style={{ fontWeight: 900, marginBottom: 4 }}>
                      {d.title || `Urządzenie #${d.id}`}
                    </div>
                    <div style={{ fontSize: 11, color: MUTED }}>
                      📦 Magazyn • {d.warehouse || warehouseKey}
                    </div>
                  </td>

                  <td style={tdStyle}>
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "4px 10px",
                        borderRadius: 999,
                        border: `1px solid ${BORDER}`,
                        background: "rgba(255,255,255,0.06)",
                        fontWeight: 900,
                        fontSize: 11,
                        whiteSpace: "nowrap",
                      }}
                    >
                      <span
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: 999,
                          background: typeColor(d.status),
                        }}
                      />
                      {statusLabel(d.status)}
                    </span>
                  </td>

                  <td style={tdStyle}>
                    <div style={{ whiteSpace: "pre-wrap", color: "rgba(255,255,255,0.85)" }}>
                      {d.note ? d.note : <span style={{ color: MUTED }}>Brak</span>}
                    </div>
                  </td>

                  <td style={tdStyle}>
                    <button
                      onClick={() => onPickDevice?.(d)}
                      style={{
                        ...btnStyle,
                        background: "rgba(255,255,255,0.10)",
                        width: "100%",
                      }}
                      title="Otwórz urządzenie"
                      type="button"
                    >
                      Otwórz
                    </button>
                  </td>
                </tr>
              ))}

              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ ...tdStyle, color: MUTED }}>
                    Brak wyników dla wybranych filtrów.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function CreateDeviceModal({
  open,
  onClose,
  onCreate,
  form,
  setForm,
  BORDER,
  TEXT_LIGHT,
  MUTED,
  GLASS_BG,
  DEVICE_TYPES,
  WAREHOUSES,
}) {
  useLockBodyScroll(open);
  useEscapeToClose(open, onClose);

  if (!open) return null;

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

  const bodyStyle = { padding: 12, display: "grid", gap: 10 };

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
  };

  const safeDeviceTypes = Array.isArray(DEVICE_TYPES) ? DEVICE_TYPES : [];
  const safeWarehouses = Array.isArray(WAREHOUSES) ? WAREHOUSES : [];

  return (
    <div
      style={overlayStyle}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        style={modalStyle}
        onMouseDown={(e) => {
          e.stopPropagation();
        }}
      >
        <div style={headerStyle}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, lineHeight: 1.15, fontWeight: 900 }}>
              Dodaj urządzenie
            </div>
            <div style={{ fontSize: 11, color: MUTED, opacity: 0.9, marginTop: 2 }}>
              Uzupełnij dane i zapisz.
            </div>
          </div>

          <button
            onClick={onClose}
            style={{ ...btnStyle, background: "rgba(255,255,255,0.06)" }}
            type="button"
          >
            Zamknij
          </button>
        </div>

        <div style={bodyStyle}>
          <label style={labelStyleLocal}>Nazwa</label>
          <input
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            style={inputStyleLocal}
            placeholder="np. Laptop Dell 5420"
          />

          <label style={labelStyleLocal}>Rodzaj urządzenia</label>
          <select
            value={form.status}
            onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
            style={inputStyleLocal}
          >
            {safeDeviceTypes.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>

          {/* MAGAZYN */}
          <label style={{ ...labelStyleLocal, display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={!!form.in_storage}
              onChange={(e) => {
                const checked = e.target.checked;
                setForm((f) => ({
                  ...f,
                  in_storage: checked,
                  lat: checked ? "" : f.lat,
                  lng: checked ? "" : f.lng,
                  warehouse: checked ? (f.warehouse || "GEO_BB") : f.warehouse,
                }));
              }}
            />
            Urządzenie na magazynie (bez współrzędnych)
          </label>

          {form.in_storage ? (
            <>
              <label style={labelStyleLocal}>Wybierz magazyn</label>
              <select
                value={form.warehouse || "GEO_BB"}
                onChange={(e) => setForm((f) => ({ ...f, warehouse: e.target.value }))}
                style={inputStyleLocal}
              >
                {safeWarehouses.map((w) => (
                  <option key={w.value} value={w.value}>
                    {w.label}
                  </option>
                ))}
              </select>
            </>
          ) : null}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={labelStyleLocal}>Lat</label>
              <input
                type="number"
                step="any"
                value={form.lat}
                disabled={!!form.in_storage}
                onChange={(e) => setForm((f) => ({ ...f, lat: e.target.value }))}
                style={inputStyleLocal}
                placeholder="np. 52.2297"
              />
            </div>

            <div>
              <label style={labelStyleLocal}>Lng</label>
              <input
                type="number"
                step="any"
                value={form.lng}
                disabled={!!form.in_storage}
                onChange={(e) => setForm((f) => ({ ...f, lng: e.target.value }))}
                style={inputStyleLocal}
                placeholder="np. 21.0122"
              />
            </div>
          </div>

          <label style={labelStyleLocal}>Opis</label>
          <textarea
            value={form.note}
            onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
            style={textareaStyleLocal}
            placeholder="Notatka do urządzenia…"
          />

          <div style={{ height: 1, background: BORDER, opacity: 0.9, marginTop: 2 }} />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <button
              onClick={onClose}
              style={{ ...btnStyle, background: "rgba(255,255,255,0.05)" }}
              type="button"
            >
              Anuluj
            </button>
            <button
              onClick={onCreate}
              style={{ ...btnStyle, background: "rgba(255,255,255,0.10)" }}
              type="button"
            >
              Zapisz i dodaj
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

      // ✅ target bywa node bez closest (np. SVG path/text)
      const closest = typeof target.closest === "function" ? target.closest.bind(target) : null;

      const isInteractive =
        closest?.(
          ".leaflet-marker-icon, .leaflet-interactive, .leaflet-popup, .leaflet-control, .leaflet-tooltip"
        ) ?? false;

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

  /** ===== Warehouse modal state ===== */
  const [warehouseModalOpen, setWarehouseModalOpen] = useState(false);
  const [activeWarehouse, setActiveWarehouse] = useState(null);

  function openWarehouse(key) {
    setActiveWarehouse(key);
    setWarehouseModalOpen(true);
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

    setWarehouseModalOpen(false);
    setActiveWarehouse(null);

    if (reason === "expired") setAuthNotice("Sesja wygasła — zaloguj się ponownie.");
    else setAuthNotice("");
  }

  async function authFetch(url, options = {}) {
    const headers = { ...(options.headers || {}) };
    const t = getToken();
    if (t) headers.Authorization = `Bearer ${t}`;
    return fetch(url, { ...options, headers });
  }

  /** ===== DEVICES (points adapter) ===== */
  const [points, setPoints] = useState([]);
  const [selectedPointId, setSelectedPointId] = useState(null);

  const selectedPoint = useMemo(
    () => points.find((p) => p.id === selectedPointId) || null,
    [points, selectedPointId]
  );

  const [loadingPoints, setLoadingPoints] = useState(false);
  const [apiError, setApiError] = useState("");

  const pinIcons = useMemo(() => {
    const icons = {};
    for (const t of DEVICE_TYPES) icons[t.value] = makePinIcon(typeColor(t.value));
    icons.__default = makePinIcon(typeColor(null));
    return icons;
  }, []);

  /** ===== Map + refs (zoom/popup) ===== */
  const mapRef = useRef(null);
  const markerRefs = useRef({});
  const suppressNextMapClickRef = useRef(false);

  /** ===== Filters + Add mode ===== */
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [storageOpen, setStorageOpen] = useState(false);
  const [addMode, setAddMode] = useState("none"); // none | point | manual

  const [visibleTypes, setVisibleTypes] = useState(() => {
    const obj = {};
    for (const t of DEVICE_TYPES) obj[t.value] = true;
    return obj;
  });

  /** ===== Cursor crosshair ===== */
  const crosshairRef = useRef(null);
  const [isDraggingMap, setIsDraggingMap] = useState(false);

  useEffect(() => {
    if (addMode !== "point") {
      if (crosshairRef.current) crosshairRef.current.style.display = "none";
      return;
    }

    let raf = 0;

    const move = (e) => {
      if (isDraggingMap) return;

      const el = crosshairRef.current;
      if (!el) return;

      if (el.style.display !== "block") el.style.display = "block";

      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        el.style.left = `${e.clientX}px`;
        el.style.top = `${e.clientY}px`;
      });
    };

    const hide = () => {
      if (crosshairRef.current) crosshairRef.current.style.display = "none";
    };

    window.addEventListener("mousemove", move, { passive: true });
    window.addEventListener("blur", hide);

    if (isDraggingMap) hide();

    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("blur", hide);
      cancelAnimationFrame(raf);
      if (crosshairRef.current) crosshairRef.current.style.display = "none";
    };
  }, [addMode, isDraggingMap]);

  useEffect(() => {
    if (addMode !== "point") return;
    if (isDraggingMap) {
      if (crosshairRef.current) crosshairRef.current.style.display = "none";
    }
  }, [isDraggingMap, addMode]);

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
      .filter((p) => visibleTypes[p.status] !== false)
      .slice()
      .sort(byPriorityThenIdDesc);
  }, [points, visibleTypes]);

  const filteredDevicesSearch = useMemo(() => {
    const q = String(projectQuery || "").trim().toLowerCase();
    const base = Array.isArray(filteredPoints) ? filteredPoints : [];
    if (!q) return base;

    return base.filter((p) => {
      const title = String(p?.title || p?.name || "").toLowerCase();
      const note = String(p?.note || p?.notes || "").toLowerCase();
      return title.includes(q) || note.includes(q);
    });
  }, [filteredPoints, projectQuery]);

  const storageDevices = useMemo(() => {
    return (Array.isArray(points) ? points : []).filter((p) => toBool(p?.in_storage));
  }, [points]);

  const storageByWarehouse = useMemo(() => {
    const map = {};
    for (const w of WAREHOUSES) map[w.value] = [];
    for (const p of storageDevices) {
      const key = p.warehouse || "GEO_BB";
      if (!map[key]) map[key] = [];
      map[key].push(p);
    }
    for (const k of Object.keys(map)) map[k] = map[k].slice().sort(byPriorityThenIdDesc);
    return map;
  }, [storageDevices]);

  const filteredStorageSearch = useMemo(() => {
    const q = String(projectQuery || "").trim().toLowerCase();
    const all = storageDevices.slice().sort(byPriorityThenIdDesc);
    if (!q) return all;

    return all.filter((p) => {
      const title = String(p?.title || p?.name || "").toLowerCase();
      const note = String(p?.note || p?.notes || "").toLowerCase();
      const wh = String(p?.warehouse || "").toLowerCase();
      return title.includes(q) || note.includes(q) || wh.includes(q);
    });
  }, [storageDevices, projectQuery]);

  const counts = useMemo(() => {
    const c = {};
    for (const t of DEVICE_TYPES) c[t.value] = 0;
    for (const p of points) if (c[p.status] !== undefined) c[p.status]++;
    return c;
  }, [points]);

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({
    title: "",
    status: "tachimetr",
    note: "",
    lat: "",
    lng: "",
    in_storage: false,
    warehouse: "",
  });

  function showAllTypes() {
    const obj = {};
    for (const t of DEVICE_TYPES) obj[t.value] = true;
    setVisibleTypes(obj);
  }

  function hideAllTypes() {
    const obj = {};
    for (const t of DEVICE_TYPES) obj[t.value] = false;
    setVisibleTypes(obj);
  }

  function focusPoint(pt) {
    const map = mapRef.current;
    if (pt?.in_storage === true) return;
    if (!map || !pt) return;

    const lat = Number(pt.lat);
    const lng = Number(pt.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

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

  function jumpToProject(kind, entityId) {
    if (kind !== "points") return;

    const pt = points.find((x) => String(x.id) === String(entityId));
    if (!pt) return;

    setSelectedPointId(pt.id);
    if (toBool(pt.in_storage)) {
      // dla wpisów magazynowych: otwieramy edycję, bo na mapie nie ma markera
      setEditOpen(true);
    } else {
      focusPoint(pt);
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
        Array.isArray(data)
          ? data.map((p) => ({
              ...p,
              priority: p.priority === true,
              in_storage: toBool(p.in_storage),
              warehouse: p.warehouse ?? null,
            }))
          : []
      );
    } catch (e) {
      if (e?.status === 401) return logout("expired");
      setApiError(`Nie mogę pobrać urządzeń: ${String(e)}`);
    } finally {
      setLoadingPoints(false);
    }
  }

  useEffect(() => {
    if (mode !== "app") return;
    loadPoints();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  async function deleteSelectedDevice() {
    const pt = selectedPoint;
    if (!pt) return;

    const label = `urządzenie #${pt.id} (${pt.title || "bez nazwy"})`;
    const ok = window.confirm(`Na pewno usunąć ${label}?`);
    if (!ok) return;

    setApiError("");

    try {
      const res = await authFetch(`${API}/points/${pt.id}`, { method: "DELETE" });
      await readJsonOrThrow(res);

      setPoints((prev) => prev.filter((p) => p.id !== pt.id));
      setSelectedPointId(null);

      try {
        mapRef.current?.closePopup?.();
      } catch {}
    } catch (e) {
      if (e?.status === 401) return logout("expired");
      setApiError(`Nie mogę usunąć urządzenia: ${String(e?.message || e)}`);

      try {
        await loadPoints();
      } catch {}
    }
  }

  function pickLocationFromMap(latlng) {
    setCreateForm((f) => ({
      ...f,
      lat: String(latlng.lat),
      lng: String(latlng.lng),
    }));

    setCreateOpen(true);
    setAddMode("none");

    try {
      mapRef.current?.flyTo(
        [latlng.lat, latlng.lng],
        Math.max(mapRef.current.getZoom(), 12),
        { animate: true, duration: 0.5 }
      );
    } catch {}
  }

  async function createDeviceFromForm() {
    setApiError("");

    const title = String(createForm.title || "").trim();
    const status = String(createForm.status || "tachimetr");
    const note = String(createForm.note || "");

    const in_storage = createForm.in_storage === true;
    const warehouse = in_storage ? String(createForm.warehouse || "GEO_BB") : null;

    const lat = in_storage ? null : Number(createForm.lat);
    const lng = in_storage ? null : Number(createForm.lng);

    if (!title) {
      setApiError("Podaj nazwę urządzenia.");
      return;
    }

    if (in_storage) {
      if (!warehouse) {
        setApiError("Wybierz magazyn.");
        return;
      }
    } else {
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        setApiError("Podaj poprawne współrzędne (lat/lng).");
        return;
      }
    }

    try {
      const res = await authFetch(`${API}/points`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, status, note, in_storage, warehouse, lat, lng }),
      });

      const data = await readJsonOrThrow(res);
      const normalized = {
        ...data,
        priority: data?.priority === true,
        in_storage: toBool(data?.in_storage),
        warehouse: data?.warehouse || null,
      };

      setPoints((p) => [normalized, ...p]);
      setSelectedPointId(normalized.id);

      if (!normalized.in_storage) focusPoint(normalized);

      setCreateOpen(false);
      setAddMode("none");

      setCreateForm({
        title: "",
        status: "tachimetr",
        note: "",
        lat: "",
        lng: "",
        in_storage: false,
        warehouse: "GEO_BB",
      });
    } catch (e) {
      if (e?.status === 401) return logout("expired");
      setApiError(`Nie mogę dodać urządzenia: ${String(e?.message || e)}`);
    }
  }

  async function saveEditedDevice(payload) {
    const pt = selectedPoint;
    if (!pt) return;

    setApiError("");

    try {
      const res = await authFetch(`${API}/points/${pt.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: payload.title,
          note: payload.note,
          status: payload.status,

          in_storage: payload.in_storage === true,
          warehouse: payload.in_storage ? payload.warehouse : null,

          // współrzędne tylko jeśli NIE magazyn:
          lat: payload.in_storage ? null : pt.lat,
          lng: payload.in_storage ? null : pt.lng,
        }),
      });

      const updated = await readJsonOrThrow(res);

      setPoints((prev) =>
        prev.map((p) =>
          p.id === updated.id ? { ...updated, priority: updated.priority === true } : p
        )
      );

      setSelectedPointId(updated.id);
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
      setApiError(`Nie mogę ustawić priorytetu urządzenia: ${String(e?.message || e)}`);
    }
  }

  /** ===== Devices CRUD (dodawanie) ===== */
  async function addPoint(latlng) {
    setApiError("");
    const body = {
      title: "Nowe urządzenie",
      note: "",
      status: "tachimetr",
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

      focusPoint(normalized);
      setAddMode("none");
    } catch (e) {
      if (e?.status === 401) return logout("expired");
      setApiError(`Nie mogę dodać urządzenia: ${String(e)}`);
    }
  }

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
            <div style={brandText}>Ewidencja sprzętu</div>
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
            {/* ... tu zostaje Twój sidebar bez zmian ... */}

            {/* WAŻNE: w mapowaniu listy urządzeń zmień klik dla magazynu: */}
            {/* ZAMIAST:
               if (x.in_storage) {
  openWarehouse(x.warehouse || "GEO_BB");
} else {
  focusPoint(x);
}
            */}
          </>
        ) : null}
      </aside>

      {/* MAP */}
      <main
        className={`${addMode === "point" ? "tmPickMode" : ""} ${
          addMode === "point" && isDraggingMap ? "tmPickModeDragging" : ""
        }`}
        style={{
          width: "100%",
          height: "100%",
          position: "relative",
        }}
      >
        {addMode === "point" ? (
          <div ref={crosshairRef} className="tmCursorCrosshair" style={{ display: "none" }} />
        ) : null}

        <StorageOverlay
          open={storageOpen}
          onToggle={() => setStorageOpen((o) => !o)}
          storageDevices={storageDevices}
          storageByWarehouse={storageByWarehouse}
          filteredStorageSearch={filteredStorageSearch}
          selectedPointId={selectedPointId}
          setSelectedPointId={setSelectedPointId}
          setEditOpen={setEditOpen}
          onOpenWarehouse={openWarehouse}
          BORDER={BORDER}
          MUTED={MUTED}
          GLASS_BG={GLASS_BG}
          GLASS_SHADOW={GLASS_SHADOW}
        />

        {/* ... tu zostaje Twoja mapa + panele bez zmian ... */}

        <MapContainer
          bounds={POLAND_BOUNDS}
          boundsOptions={{ padding: [20, 20] }}
          style={{ width: "100%", height: "100%" }}
          zoomControl={false}
          minZoom={3}
        >
          {/* ... bez zmian ... */}
        </MapContainer>

        {/* ===== KLUCZOWA POPRAWKA: MODAL MAGAZYNU JEST TU, W RETURN APP() ===== */}
        <WarehouseDevicesModal
          open={warehouseModalOpen}
          warehouseKey={activeWarehouse}
          items={activeWarehouse ? storageByWarehouse?.[activeWarehouse] || [] : []}
          onClose={() => setWarehouseModalOpen(false)}
          onPickDevice={(d) => {
            setSelectedPointId(d.id);
            setEditOpen(true);
            setWarehouseModalOpen(false);
          }}
          BORDER={BORDER}
          MUTED={MUTED}
          TEXT_LIGHT={TEXT_LIGHT}
          GLASS_BG={GLASS_BG_DARK}
          GLASS_SHADOW={GLASS_SHADOW}
        />

        <EditDeviceModal
          open={editOpen}
          device={
            selectedPoint ? { ...selectedPoint, acquired: isAcquired("points", selectedPoint.id) } : null
          }
          onClose={() => setEditOpen(false)}
          onSave={saveEditedDevice}
          BORDER={BORDER}
          TEXT_LIGHT={TEXT_LIGHT}
          MUTED={MUTED}
          GLASS_BG={GLASS_BG_DARK}
        />

        <CreateDeviceModal
          open={createOpen}
          onClose={() => {
            setCreateOpen(false);
            if (addMode === "manual") setAddMode("none");
          }}
          onCreate={createDeviceFromForm}
          form={createForm}
          setForm={setCreateForm}
          BORDER={BORDER}
          TEXT_LIGHT={TEXT_LIGHT}
          MUTED={MUTED}
          GLASS_BG={GLASS_BG_DARK}
          DEVICE_TYPES={DEVICE_TYPES}
          WAREHOUSES={WAREHOUSES}
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