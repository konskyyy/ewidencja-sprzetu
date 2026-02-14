import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { API_BASE, getToken, loginRequest, meRequest, setToken } from "./api";
import { QRCodeCanvas } from "qrcode.react";

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
const API_BASE_SAFE =
  (typeof API_BASE === "string" && API_BASE.trim()) ||
  import.meta.env.VITE_API_BASE ||
  ""; // albo "http://localhost:3001"

const API = API_BASE_SAFE.endsWith("/api") ? API_BASE_SAFE : `${API_BASE_SAFE}/api`;


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
  { value: "SERWIS", label: "SERWIS" },
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
  const warehouseIcon = (key) => {
  if (key === "SERWIS") return "🛠️";
  return "📦";
};

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
          {storageDevices.length} {open ? "▾" : "▸"}
        </span>
      </div>

      {/* BODY — TYLKO TO JEST ZWIJANE */}
      {open && (
        <div style={{ padding: 12, display: "grid", gap: 10 }}>
          {/* kafelki magazynów */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {Object.entries(storageByWarehouse).map(([key, list]) => (
            <button
              key={key}
              onClick={(e) => {
                e.stopPropagation();
                onOpenWarehouse?.(key);
              }}
              style={{
                all: "unset",
                padding: "8px 10px",
                borderRadius: 12,
                border: `1px solid ${BORDER}`,
                background: "rgba(255,255,255,0.05)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                cursor: "pointer",
                transition: "transform 120ms ease, background 120ms ease",
              }}
              title={`Otwórz magazyn ${key}`}
            >
              <span style={{ fontWeight: 800, fontSize: 12 }}>
              {warehouseIcon(key)} {key}
              </span>
              <span style={{ fontSize: 12, color: MUTED, fontWeight: 900 }}>
                {list.length}
              </span>
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

function deviceDeepLink(deviceId) {
  const base = window.location.origin + window.location.pathname; // bez query
  const url = new URL(base);
  url.searchParams.set("device", String(deviceId));
  return url.toString();
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
  return typeColor(status);
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

function makePinIcon(pinColor, badgeTone = null) {
  const show = badgeTone === "warn" || badgeTone === "overdue";

  const badgeBg =
    badgeTone === "overdue"
      ? "rgba(239,68,68,0.95)"   // czerwony
      : badgeTone === "warn"
      ? "rgba(245,158,11,0.95)"  // pomarańcz
      : "transparent";

  return L.divIcon({
    className: "leaflet-div-icon tmPinWrap",
    html: `
      <div class="tmPinHost">
        ${pinSvg(pinColor)}
        ${show ? `<div class="tmStatusBadge" style="background:${badgeBg}">!</div>` : ""}
      </div>
    `,
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
function toNumCoord(v) {
  if (v === null || v === undefined) return NaN;
  const s = String(v).trim().replace(",", ".");
  return Number(s);
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

function calcCalibrationDaysLeft(lastCalibrationAt, intervalYears) {
  if (!lastCalibrationAt || !intervalYears) return null;

  const start = new Date(lastCalibrationAt);
  if (!Number.isFinite(start.getTime())) return null;

  const years = Number(intervalYears);
  if (![1, 2, 3].includes(years)) return null;

  const due = new Date(start);
  due.setFullYear(due.getFullYear() + years);

  const msLeft = due.getTime() - Date.now();
  return Math.ceil(msLeft / (1000 * 60 * 60 * 24));
}

function calibrationMeta(device) {
  // 1) Najpierw bierzemy to, co policzył backend
  let days = device?.calibration_days_left;

  // 2) Jeśli backend nie przysłał, licz lokalnie
  if (days === null || days === undefined) {
    const last = device?.last_calibration_at;
    const interval = Number(device?.calibration_interval_years);

    if (!last || !interval || !Number.isFinite(interval)) {
      return { tone: "none", label: "brak danych", daysLeft: null };
    }

    const lastDate = new Date(last);
    if (Number.isNaN(lastDate.getTime())) {
      return { tone: "none", label: "błędna data", daysLeft: null };
    }

    const next = new Date(lastDate);
    next.setFullYear(next.getFullYear() + interval);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    next.setHours(0, 0, 0, 0);

    const diffMs = next - today;
    days = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  }

  const n = Number(days);
  if (!Number.isFinite(n)) return { tone: "none", label: "brak danych", daysLeft: null };

  if (n < 0) return { tone: "overdue", label: `po terminie (${Math.abs(n)} dni)`, daysLeft: n };
  if (n <= 30) return { tone: "warn", label: `${n} dni`, daysLeft: n };
  return { tone: "ok", label: `${n} dni`, daysLeft: n };
}



function calibrationPillStyle(tone, BORDER) {
  // bez narzucania palety w całej appce — tylko tu, w jednym miejscu
  if (tone === "overdue") {
    return {
      border: "1px solid rgba(255,80,80,0.55)",
      background: "rgba(255,80,80,0.14)",
      color: "rgba(255,255,255,0.92)",
    };
  }
  if (tone === "warn") {
    return {
      border: "1px solid rgba(245,158,11,0.55)",
      background: "rgba(245,158,11,0.14)",
      color: "rgba(255,255,255,0.92)",
    };
  }
  if (tone === "ok") {
    return {
      border: "1px solid rgba(34,197,94,0.55)",
      background: "rgba(34,197,94,0.12)",
      color: "rgba(255,255,255,0.92)",
    };
  }
  return {
    border: `1px solid ${BORDER}`,
    background: "rgba(255,255,255,0.06)",
    color: "rgba(255,255,255,0.80)",
  };
}
function calibrationUrgencyRank(pt) {
  const cal = calibrationMeta(pt);
  if (cal.tone === "overdue") return 0;
  if (cal.tone === "warn") return 1;
  if (cal.tone === "ok") return 2;
  return 3; // brak danych na końcu
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

  // ✅ kalibracja
  last_calibration_at: "",          // "YYYY-MM-DD"
  calibration_interval_years: "",   // "1" | "2" | "3" | ""
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

  // ✅ kalibracja: przyjmujemy YYYY-MM-DD (jeśli backend zwraca ISO)
  last_calibration_at: device.last_calibration_at
    ? String(device.last_calibration_at).slice(0, 10)
    : "",
  calibration_interval_years:
    device.calibration_interval_years != null
      ? String(device.calibration_interval_years)
      : "",
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

  
  // ✅ kalibracja
  last_calibration_at: form.last_calibration_at ? form.last_calibration_at : null,
  calibration_interval_years: form.calibration_interval_years
    ? Number(form.calibration_interval_years)
    : null,
};


  if (!payload.title.trim()) {
    setErr("Nazwa urządzenia nie może być pusta.");
    return;

  }
  if (!payload.in_storage) {
  // urządzenie musi mieć współrzędne, ale modal ich nie zbiera
  // więc co najmniej wymuś, że device już je ma
  const lat = toNumCoord(device?.lat);
const lng = toNumCoord(device?.lng);
if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
  setErr("To urządzenie nie ma współrzędnych...");
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
          {/* ✅ KALIBRACJA */}
<div style={{ height: 1, background: BORDER, opacity: 0.9, marginTop: 2 }} />

<div style={{ fontWeight: 900, fontSize: 12, opacity: 0.9, marginTop: 2 }}>
  Kalibracja
</div>

<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
  <div>
    <label style={labelStyleLocal}>Data ostatniej kalibracji</label>
    <input
      type="date"
      value={form.last_calibration_at || ""}
      onChange={(e) => setForm((f) => ({ ...f, last_calibration_at: e.target.value }))}
      style={inputStyleLocal}
    />
  </div>

  <div>
    <label style={labelStyleLocal}>Interwał kalibracji</label>
    <select
      value={form.calibration_interval_years || ""}
      onChange={(e) => setForm((f) => ({ ...f, calibration_interval_years: e.target.value }))}
      style={inputStyleLocal}
    >
      <option value="">— brak —</option>
      <option value="1">Co 1 rok</option>
      <option value="2">Co 2 lata</option>
      <option value="3">Co 3 lata</option>
    </select>
  </div>
</div>

{/* ✅ QR / szybkie otwieranie */}
<div style={{ height: 1, background: BORDER, opacity: 0.9, marginTop: 2 }} />

<div style={{ fontWeight: 900, fontSize: 12, opacity: 0.9, marginTop: 2 }}>
  QR Code (szybkie otwieranie)
</div>

<div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
  <div
    id="qrWrap"
    style={{
      padding: 10,
      borderRadius: 14,
      border: `1px solid ${BORDER}`,
      background: "rgba(255,255,255,0.06)",
      width: "fit-content",
    }}
  >
    <QRCodeCanvas value={deviceDeepLink(device.id)} size={110} />
  </div>

  <div style={{ minWidth: 220, display: "grid", gap: 8 }}>
    <div style={{ fontSize: 11, color: MUTED }}>
      Zeskanuj telefonem, żeby otworzyć właściwości urządzenia.
    </div>

    <button
      type="button"
      onClick={() => {
        const wrap = document.getElementById("qrWrap");
        const canvas = wrap?.querySelector("canvas");
        if (!canvas) return;
        const url = canvas.toDataURL("image/png");
        const a = document.createElement("a");
        a.href = url;
        a.download = `device-${device.id}-qr.png`;
        a.click();
      }}
      style={{
        padding: "9px 10px",
        borderRadius: 12,
        border: `1px solid ${BORDER}`,
        background: "rgba(255,255,255,0.08)",
        color: TEXT_LIGHT,
        cursor: "pointer",
        fontWeight: 900,
        fontSize: 12,
        width: "fit-content",
      }}
    >
      Pobierz PNG
    </button>

    <input
      readOnly
      value={deviceDeepLink(device.id)}
      style={{
        boxSizing: "border-box",
        width: "100%",
        height: 34,
        borderRadius: 12,
        border: `1px solid ${BORDER}`,
        background: "rgba(255,255,255,0.06)",
        color: TEXT_LIGHT,
        padding: "0 10px",
        fontSize: 11,
        fontWeight: 700,
      }}
    />

    <button
      type="button"
      onClick={() => navigator.clipboard?.writeText(deviceDeepLink(device.id))}
      style={{
        padding: "9px 10px",
        borderRadius: 12,
        border: `1px solid ${BORDER}`,
        background: "rgba(255,255,255,0.08)",
        color: TEXT_LIGHT,
        cursor: "pointer",
        fontWeight: 900,
        fontSize: 12,
        width: "fit-content",
      }}
    >
      Kopiuj link
    </button>
  </div>
</div>

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
  WAREHOUSES
}) {
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
            <div style={{ fontSize: 13, lineHeight: 1.15, fontWeight: 900 }}>
              Dodaj urządzenie (ręcznie)
            </div>
            <div style={{ fontSize: 11, color: MUTED, opacity: 0.9, marginTop: 2 }}>
              Wpisz współrzędne i zapisz.
            </div>
          </div>

          <button onClick={onClose} style={{ ...btnStyle, background: "rgba(255,255,255,0.06)" }}>
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
            {(DEVICE_TYPES || []).map((t) => (
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
        // gdy magazyn = true -> czyść współrzędne i ustaw domyślny warehouse
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
      {WAREHOUSES.map((w) => (
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
          {/* ✅ KALIBRACJA */}
<div style={{ height: 1, background: BORDER, opacity: 0.9, marginTop: 2 }} />

<div style={{ fontWeight: 900, fontSize: 12, opacity: 0.9, marginTop: 2 }}>
  Kalibracja
</div>

<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
  <div>
    <label style={labelStyleLocal}>Data ostatniej kalibracji</label>
    <input
      type="date"
      value={form.last_calibration_at || ""}
      onChange={(e) => setForm((f) => ({ ...f, last_calibration_at: e.target.value }))}
      style={inputStyleLocal}
    />
  </div>

  <div>
    <label style={labelStyleLocal}>Interwał kalibracji</label>
    <select
      value={form.calibration_interval_years || ""}
      onChange={(e) => setForm((f) => ({ ...f, calibration_interval_years: e.target.value }))}
      style={inputStyleLocal}
    >
      <option value="">— brak —</option>
      <option value="1">Co 1 rok</option>
      <option value="2">Co 2 lata</option>
      <option value="3">Co 3 lata</option>
    </select>
  </div>
</div>


          <div style={{ height: 1, background: BORDER, opacity: 0.9, marginTop: 2 }} />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <button onClick={onClose} style={{ ...btnStyle, background: "rgba(255,255,255,0.05)" }}>
              Anuluj
            </button>
            <button onClick={onCreate} style={{ ...btnStyle, background: "rgba(255,255,255,0.10)" }}>
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

      const isInteractive = target.closest(
        ".leaflet-marker-icon, .leaflet-interactive, .leaflet-popup, .leaflet-popup-content-wrapper, .leaflet-popup-content, .leaflet-control, .leaflet-tooltip"
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
  const [projectQuery, setProjectQuery] = useState("");
  const [onlyOverdue, setOnlyOverdue] = useState(false);

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
  function openWarehouse(key) {
  setActiveWarehouse(key);
  setWarehouseModalOpen(true);
}

 function WarehouseModal({
  open,
  warehouseKey,
  devices,
  onClose,
  onSelectDevice, // (device) => void (edytuj)
  onShowOnMap,    // (device) => void (flyTo)
  BORDER,
  TEXT_LIGHT,
  MUTED,
  GLASS_BG,
  GLASS_SHADOW,
}) {
  const [sort, setSort] = useState({ key: "title", dir: "asc" }); // key: title|status|id|note|calibration
  const [filters, setFilters] = useState({
    title: "",
    status: "all",
    note: "",
    id: "",
  });

  useEffect(() => {
    if (!open) return;
    // reset tylko filtrów, sort zostawiamy (użyteczne)
    setFilters({ title: "", status: "all", note: "", id: "" });
  }, [open, warehouseKey]);

  if (!open) return null;

  const list = Array.isArray(devices) ? devices : [];

  const statusOptions = useMemo(() => {
    const set = new Set();
    for (const d of list) set.add(String(d?.status || ""));
    return ["all", ...Array.from(set).filter(Boolean)];
  }, [list]);

  function toggleSort(key) {
    setSort((prev) => {
      if (prev.key !== key) return { key, dir: "asc" };
      return { key, dir: prev.dir === "asc" ? "desc" : "asc" };
    });
  }

  function sortIcon(key) {
    if (sort.key !== key) return "⇅";
    return sort.dir === "asc" ? "↑" : "↓";
  }

  const filteredSorted = useMemo(() => {
    const fTitle = String(filters.title || "").trim().toLowerCase();
    const fNote = String(filters.note || "").trim().toLowerCase();
    const fId = String(filters.id || "").trim();
    const fStatus = String(filters.status || "all");

    let arr = list.slice();

    // filtr ID
    if (fId) {
      arr = arr.filter((d) => String(d?.id || "").includes(fId));
    }
    // filtr status
    if (fStatus !== "all") {
      arr = arr.filter((d) => String(d?.status || "") === fStatus);
    }
    // filtr tytuł
    if (fTitle) {
      arr = arr.filter((d) =>
        String(d?.title || d?.name || "").toLowerCase().includes(fTitle)
      );
    }
    // filtr notatka
    if (fNote) {
      arr = arr.filter((d) =>
        String(d?.note || d?.notes || "").toLowerCase().includes(fNote)
      );
    }

    // sortowanie
    const dir = sort.dir === "asc" ? 1 : -1;
    const key = sort.key;

    arr.sort((a, b) => {
  const key = sort.key;
  const dirNum = sort.dir === "asc" ? 1 : -1;

  // ID (numerycznie)
  if (key === "id") {
    return (Number(a?.id) - Number(b?.id)) * dirNum;
  }

  // KALIBRACJA (po dniach)
  if (key === "calibration") {
    const da = calibrationMeta(a)?.daysLeft;
    const db = calibrationMeta(b)?.daysLeft;

    const aHas = Number.isFinite(da);
    const bHas = Number.isFinite(db);

    // brak danych zawsze na końcu
    if (aHas && !bHas) return -1;
    if (!aHas && bHas) return 1;
    if (!aHas && !bHas) return 0;

    return (da - db) * dirNum;
  }

  // TEKSTOWE (title / status / note)
  const av =
    key === "title"
      ? String(a?.title || a?.name || "")
      : key === "status"
      ? String(a?.status || "")
      : String(a?.note || a?.notes || "");

  const bv =
    key === "title"
      ? String(b?.title || b?.name || "")
      : key === "status"
      ? String(b?.status || "")
      : String(b?.note || b?.notes || "");

  return av.localeCompare(bv, "pl", { sensitivity: "base" }) * dirNum;
});


    return arr;
  }, [list, filters, sort]);

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
    width: "min(980px, 100%)",
    maxHeight: "min(760px, calc(100vh - 32px))",
    borderRadius: 16,
    border: `1px solid ${BORDER}`,
    background: GLASS_BG,
    backgroundImage:
      "radial-gradient(700px 420px at 20% 10%, rgba(255,255,255,0.10), transparent 60%)",
    color: TEXT_LIGHT,
    boxShadow: GLASS_SHADOW,
    overflow: "hidden",
    backdropFilter: "blur(10px)",
    display: "grid",
    gridTemplateRows: "auto 1fr",
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

  const btnStyle = {
    padding: "9px 10px",
    borderRadius: 12,
    border: `1px solid ${BORDER}`,
    background: "rgba(255,255,255,0.06)",
    color: TEXT_LIGHT,
    cursor: "pointer",
    fontWeight: 900,
    fontSize: 12,
  };

  const tableWrapStyle = {
    padding: 12,
    overflow: "auto",
  };

  const tableStyle = {
    width: "100%",
    borderCollapse: "separate",
    borderSpacing: 0,
    overflow: "hidden",
    borderRadius: 14,
    border: `1px solid ${BORDER}`,
    background: "rgba(255,255,255,0.04)",
  };

  const thStyle = {
    position: "sticky",
    top: 0,
    zIndex: 2,
    textAlign: "left",
    padding: "10px 10px",
    fontSize: 12,
    fontWeight: 900,
    background: "rgba(0,0,0,0.16)",
    borderBottom: `1px solid ${BORDER}`,
    whiteSpace: "nowrap",
    cursor: "pointer",
    userSelect: "none",
  };

  const filterCellStyle = {
    position: "sticky",
    top: 38, // wysokość headera tabeli
    zIndex: 2,
    padding: "8px 10px",
    background: "rgba(0,0,0,0.10)",
    borderBottom: `1px solid ${BORDER}`,
  };

  const tdStyle = {
    padding: "10px 10px",
    fontSize: 12,
    borderBottom: `1px solid ${BORDER}`,
    verticalAlign: "top",
  };

  const inputStyle = {
    width: "100%",
    boxSizing: "border-box",
    height: 34,
    padding: "0 10px",
    borderRadius: 12,
    border: `1px solid ${BORDER}`,
    background: "rgba(255,255,255,0.07)",
    color: TEXT_LIGHT,
    outline: "none",
    fontSize: 12,
    fontWeight: 700,
  };

  const selectStyle = {
    ...inputStyle,
    height: 34,
  };

  const actionBtn = {
    padding: "7px 9px",
    borderRadius: 12,
    border: `1px solid ${BORDER}`,
    background: "rgba(255,255,255,0.06)",
    color: TEXT_LIGHT,
    cursor: "pointer",
    fontWeight: 900,
    fontSize: 12,
    whiteSpace: "nowrap",
  };

  return (
    <div
      style={overlayStyle}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div style={modalStyle}>
        {/* HEADER */}
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
              Magazyn: <b>{warehouseKey}</b>
            </div>
            <div style={{ fontSize: 11, color: MUTED, opacity: 0.9, marginTop: 2 }}>
              Rekordy:{" "}
              <b style={{ color: "rgba(255,255,255,0.88)" }}>
                {filteredSorted.length}/{list.length}
              </b>{" "}
              • Sort: <b style={{ color: "rgba(255,255,255,0.88)" }}>{sort.key}</b> ({sort.dir})
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            <button
              onClick={() => setFilters({ title: "", status: "all", note: "", id: "" })}
              style={{ ...btnStyle, background: "rgba(255,255,255,0.05)" }}
              title="Wyczyść filtry"
            >
              Wyczyść filtry
            </button>
            <button onClick={onClose} style={btnStyle}>
              Zamknij
            </button>
          </div>
        </div>

        {/* TABLE */}
<div style={tableWrapStyle}>
  <table style={tableStyle}>
    <thead>
      <tr>
        <th style={{ ...thStyle, width: 90 }} onClick={() => toggleSort("id")}>
          ID <span style={{ color: MUTED, marginLeft: 6 }}>{sortIcon("id")}</span>
        </th>
        <th style={thStyle} onClick={() => toggleSort("title")}>
          Nazwa <span style={{ color: MUTED, marginLeft: 6 }}>{sortIcon("title")}</span>
        </th>
        <th style={{ ...thStyle, width: 160 }} onClick={() => toggleSort("status")}>
          Rodzaj <span style={{ color: MUTED, marginLeft: 6 }}>{sortIcon("status")}</span>
        </th>
        <th style={thStyle} onClick={() => toggleSort("note")}>
          Opis <span style={{ color: MUTED, marginLeft: 6 }}>{sortIcon("note")}</span>
        </th>
        <th style={{ ...thStyle, width: 170 }} onClick={() => toggleSort("calibration")}>
          Kalibracja{" "}
          <span style={{ color: MUTED, marginLeft: 6 }}>{sortIcon("calibration")}</span>
        </th>
        <th style={{ ...thStyle, width: 210, cursor: "default" }}>Akcje</th>
      </tr>

      {/* WIERSZ FILTRÓW POD NAGŁÓWKAMI */}
      <tr>
        {/* ID */}
        <th style={filterCellStyle}>
          <input
            value={filters.id}
            onChange={(e) => setFilters((f) => ({ ...f, id: e.target.value }))}
            placeholder="np. 12"
            style={inputStyle}
          />
        </th>

        {/* Nazwa */}
        <th style={filterCellStyle}>
          <input
            value={filters.title}
            onChange={(e) => setFilters((f) => ({ ...f, title: e.target.value }))}
            placeholder="Szukaj nazwy..."
            style={inputStyle}
          />
        </th>

        {/* Rodzaj */}
        <th style={filterCellStyle}>
          <select
            value={filters.status}
            onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
            style={selectStyle}
          >
            {statusOptions.map((s) => (
              <option key={s} value={s}>
                {s === "all" ? "Wszystkie" : statusLabel(s)}
              </option>
            ))}
          </select>
        </th>

        {/* Opis */}
        <th style={filterCellStyle}>
          <input
            value={filters.note}
            onChange={(e) => setFilters((f) => ({ ...f, note: e.target.value }))}
            placeholder="Szukaj w opisie..."
            style={inputStyle}
          />
        </th>

        {/* Kalibracja – brak filtra (pusto) */}
        <th style={filterCellStyle}>{/* celowo puste */}</th>

        {/* Akcje */}
        <th style={filterCellStyle}>
          <div style={{ fontSize: 11, color: MUTED, fontWeight: 800 }}>
            Kliknij nagłówek, aby sortować.
          </div>
        </th>
      </tr>
    </thead>

    <tbody>
      {filteredSorted.length === 0 ? (
        <tr>
          <td style={{ ...tdStyle, color: MUTED }} colSpan={6}>
            Brak wyników dla aktywnych filtrów.
          </td>
        </tr>
      ) : (
        filteredSorted.map((d) => {
          const title = d.title || `Urządzenie #${d.id}`;
          const note = d.note || "";
          const cal = calibrationMeta(d);
          const pill = calibrationPillStyle(cal.tone, BORDER);
          const hasCoords =
            Number.isFinite(Number(d.lat)) && Number.isFinite(Number(d.lng));

          return (
            <tr key={`wh-row-${warehouseKey}-${d.id}`}>
              <td style={tdStyle}>
                <b style={{ color: "rgba(255,255,255,0.92)" }}>{d.id}</b>
              </td>

              <td style={tdStyle}>
                <div style={{ fontWeight: 900, lineHeight: 1.2 }}>{title}</div>
                <div style={{ marginTop: 4, fontSize: 11, color: MUTED }}>
                  📦 {warehouseKey}
                </div>
              </td>

              <td style={tdStyle}>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "4px 8px",
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
                      display: "inline-block",
                    }}
                  />
                  {statusLabel(d.status)}
                </span>
              </td>

              <td style={tdStyle}>
                {note ? (
                  <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.35 }}>{note}</div>
                ) : (
                  <span style={{ color: MUTED }}>Brak</span>
                )}
              </td>

              <td style={tdStyle}>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "4px 8px",
                    borderRadius: 999,
                    fontWeight: 900,
                    fontSize: 11,
                    whiteSpace: "nowrap",
                    ...pill,
                  }}
                  title={
                    cal.tone === "overdue"
                      ? "Kalibracja po terminie"
                      : cal.tone === "warn"
                      ? "Kalibracja wkrótce"
                      : cal.tone === "ok"
                      ? "Kalibracja OK"
                      : "Brak danych kalibracji"
                  }
                >
                  {cal.tone === "overdue"
                    ? "🔴"
                    : cal.tone === "warn"
                    ? "🟠"
                    : cal.tone === "ok"
                    ? "🟢"
                    : "—"}
                  {cal.label}
                </span>
              </td>

              <td style={tdStyle}>
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    justifyContent: "flex-end",
                    flexWrap: "wrap",
                  }}
                >
                  <button
                    onClick={() => onSelectDevice?.(d)}
                    style={actionBtn}
                    title="Edytuj urządzenie"
                  >
                    Edytuj
                  </button>

                  <button
                    onClick={() => onShowOnMap?.(d)}
                    style={{
                      ...actionBtn,
                      opacity: hasCoords ? 1 : 0.45,
                      cursor: hasCoords ? "pointer" : "default",
                    }}
                    disabled={!hasCoords}
                    title={hasCoords ? "Pokaż na mapie" : "Brak współrzędnych"}
                  >
                    Pokaż
                  </button>
                </div>
              </td>
            </tr>
          );
        })
      )}
    </tbody>
  </table>
</div>
      </div>
    </div>
  );
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
  for (const t of DEVICE_TYPES) {
    const baseColor = typeColor(t.value);
    icons[`${t.value}__base`] = makePinIcon(baseColor, null);
    icons[`${t.value}__warn`] = makePinIcon(baseColor, "warn");
    icons[`${t.value}__overdue`] = makePinIcon(baseColor, "overdue");
  }
  icons.__default = makePinIcon("#9ca3af", null);
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
  const [warehouseModalOpen, setWarehouseModalOpen] = useState(false);
  const [activeWarehouse, setActiveWarehouse] = useState(null);
  const [addMode, setAddMode] = useState("none"); // none | point | manual
  const [visibleTypes, setVisibleTypes] = useState(() => {
  const obj = {};
  for (const t of DEVICE_TYPES) obj[t.value] = true;
  return obj;
});

/** ===== Cursor crosshair (pozycja kursora na mapie) ===== */
const crosshairRef = useRef(null);
const [isDraggingMap, setIsDraggingMap] = useState(false);

useEffect(() => {
  // poza trybem wskazywania — chowamy krzyż i sprzątamy
  if (addMode !== "point") {
    if (crosshairRef.current) crosshairRef.current.style.display = "none";
    return;
  }

  let raf = 0;

  const move = (e) => {
    // podczas drag mapy: krzyż ma być schowany
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

  // jak tylko zaczynasz dragować mapę -> natychmiast schowaj krzyż
  if (isDraggingMap) hide();

  return () => {
    window.removeEventListener("mousemove", move);
    window.removeEventListener("blur", hide);
    cancelAnimationFrame(raf);
    if (crosshairRef.current) crosshairRef.current.style.display = "none";
  };
}, [addMode, isDraggingMap]);

useEffect(() => {
  if (mode !== "app") return;
  const map = mapRef.current;
  if (!map) return;

  const t1 = setTimeout(() => {
    try { map.invalidateSize({ pan: false }); } catch {}
  }, 220);

  const t2 = setTimeout(() => {
    try { map.invalidateSize({ pan: false }); } catch {}
  }, 420);

  return () => {
    clearTimeout(t1);
    clearTimeout(t2);
  };
}, [sidebarOpen, mode]);

// osobny efekt: tylko aktualizacja isDraggingMap (bez przepinania listenerów)
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

  if (ap !== bp) return bp - ap; // priority=true na górze
  return Number(b?.id || 0) - Number(a?.id || 0); // potem id DESC
}


  const filteredPoints = useMemo(() => {
  return points
    .filter((p) => visibleTypes[p.status] !== false)
    .slice()
    .sort(byPriorityThenIdDesc);
}, [points, visibleTypes]);

const overdueCount = useMemo(() => {
  // liczymy tylko te, które są na mapie (nie magazyn) i faktycznie overdue
  const arr = (Array.isArray(points) ? points : []).filter((p) => !toBool(p?.in_storage));
  let n = 0;
  for (const p of arr) {
    const cal = calibrationMeta(p);
    if (cal.tone === "overdue") n++;
  }
  return n;
}, [points]);

const filteredDevicesSearch = useMemo(() => {
  const q = String(projectQuery || "").trim().toLowerCase();

  let base = Array.isArray(filteredPoints) ? filteredPoints : [];

  // ✅ filtr: tylko overdue
  if (onlyOverdue) {
    base = base.filter((p) => calibrationMeta(p).tone === "overdue");
  }

  if (!q) return base;

  return base.filter((p) => {
    const title = String(p?.title || p?.name || "").toLowerCase();
    const note = String(p?.note || p?.notes || "").toLowerCase();
    return title.includes(q) || note.includes(q);
  });
}, [filteredPoints, projectQuery, onlyOverdue]);


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
  // sort w magazynie: priorytet i id (jak na mapie)
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

  for (const p of points) {
    if (c[p.status] !== undefined) {
      c[p.status]++;
    }
  }

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

  // ✅ kalibracja
  last_calibration_at: "",          // "YYYY-MM-DD" z input[type=date]
  calibration_interval_years: "",   // "1" | "2" | "3" | "" (brak)
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
  if (pt.in_storage === true) return;
  if (!map || !pt) return;

  const lat = toNumCoord(pt.lat);
const lng = toNumCoord(pt.lng);
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
  if (kind !== "points") {
    // feed może zawierać stare wpisy innych typów – nie ruszamy feedu
    return;
  }

  const pt = points.find((x) => String(x.id) === String(entityId));
  if (!pt) return;
  setSelectedPointId(pt.id);
  focusPoint(pt);
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
  if (!points || points.length === 0) return;

  const sp = new URLSearchParams(window.location.search);
  const idStr = sp.get("device");
  if (!idStr) return;

  const pt = points.find((p) => String(p.id) === String(idStr));
  if (!pt) return;

  // ustaw selekcję
  setSelectedPointId(pt.id);

  // jeśli magazyn → od razu otwórz właściwości
  if (toBool(pt.in_storage)) {
    setEditOpen(true);
    return;
  }

  // jeśli w terenie → zbliż i otwórz popup
  focusPoint(pt);

  // opcjonalnie: otwórz też właściwości po chwili
  // setTimeout(() => setEditOpen(true), 350);
}, [mode, points]); 

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
    in_storage: false,        
    warehouse: null, 
    lat: String(latlng.lat),
    lng: String(latlng.lng),
  }));

  setCreateOpen(true);   // modal ma się otworzyć po kliknięciu mapy
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
  const status = String(createForm.status || "tachimetr").trim();
  const note = String(createForm.note || "");

  const in_storage = createForm.in_storage === true;
  const warehouse = in_storage ? String(createForm.warehouse || "GEO_BB") : null;

  const lat = in_storage ? null : toNumCoord(createForm.lat);
const lng = in_storage ? null : toNumCoord(createForm.lng);

// ✅ waliduj współrzędne tylko jeśli NIE jest na magazynie
if (!in_storage) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    setApiError("Podaj poprawne współrzędne (lat/lng).");
    return;
  }
}

  // ✅ kalibracja
  const last_calibration_at = createForm.last_calibration_at
    ? String(createForm.last_calibration_at)
    : null;

  const calibration_interval_years = createForm.calibration_interval_years
    ? Number(createForm.calibration_interval_years)
    : null;

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
      body: JSON.stringify({
        title,
        note,
        status,
        in_storage,
        warehouse,
        lat,
        lng,
        last_calibration_at,
        calibration_interval_years,
      }),
    });

    const data = await readJsonOrThrow(res);

    const normalized = {
      ...data,
      priority: data?.priority === true,
      in_storage: toBool(data?.in_storage),
      warehouse: data?.warehouse ?? null,
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
      last_calibration_at: "",
      calibration_interval_years: "",
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

  lat: payload.in_storage ? null : toNumCoord(pt.lat),
lng: payload.in_storage ? null : toNumCoord(pt.lng),

  last_calibration_at: payload.last_calibration_at ?? null,
  calibration_interval_years: payload.calibration_interval_years ?? null,
}),
    });

    const updated = await readJsonOrThrow(res);

    setPoints((prev) =>
  prev.map((p) =>
    p.id === updated.id
      ? {
          ...updated,
          priority: updated?.priority === true,
          in_storage: toBool(updated?.in_storage),
          warehouse: updated?.warehouse ?? null,
        }
      : p
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
        p.id === updated.id
          ? { ...updated, priority: updated.priority === true }
          : p
      )
    );
  } catch (e) {
    if (e?.status === 401) return logout("expired");
    setApiError(
      `Nie mogę ustawić priorytetu urządzenia: ${String(e?.message || e)}`
    );
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
      const normalized = {
  ...data,
  priority: data?.priority === true,
  in_storage: toBool(data?.in_storage),
  warehouse: data?.warehouse ?? null,
};

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
              GEO
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
              Ewidencja sprzętu
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
          <div style={{ fontWeight: 800, marginBottom: 8, fontSize: 13 }}>
            Dodawanie urządzenia
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {/* MAGAZYN */}
            <button
              onClick={() => {
                setAddMode("manual");
                setCreateOpen(true);
               setCreateForm({
  title: "",
  status: "tachimetr",
  note: "",
  lat: "",
  lng: "",
  in_storage: true,
  warehouse: "GEO_BB",

  // ✅ kalibracja
  last_calibration_at: "",
  calibration_interval_years: "",
});
              }}
              style={{
                padding: "9px 10px",
                borderRadius: 12,
                border: `1px solid ${BORDER}`,
                background: "rgba(255,255,255,0.08)",
                color: TEXT_LIGHT,
                cursor: "pointer",
                fontWeight: 800,
                fontSize: 12,
              }}
            >➕ Dodaj
            </button>

            {/* WSKAŻ NA MAPIE */}
            <button
              onClick={() => {
                setCreateOpen(false);
                setAddMode((m) => (m === "point" ? "none" : "point"));
                setCreateForm({
  title: "",
  status: "tachimetr",
  note: "",
  lat: "",
  lng: "",
  in_storage: true,
  warehouse: "GEO_BB",

  // ✅ kalibracja
  last_calibration_at: "",
  calibration_interval_years: "",
});
              }}
              style={{
                padding: "9px 10px",
                borderRadius: 12,
                border: `1px solid ${BORDER}`,
                background: addMode === "point" ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.08)",
                color: TEXT_LIGHT,
                cursor: "pointer",
                fontWeight: 800,
                fontSize: 12,
              }}
            >
              📍 Wskaż na mapie
            </button>
          </div>

          <div style={{ marginTop: 8, fontSize: 11, color: MUTED, lineHeight: 1.35 }}>
            {addMode === "manual"
              ? "Dodawanie: modal — uzupełnij dane i zapisz."
              : addMode === "point"
              ? "Dodawanie: wskaż na mapie — kliknij mapę, aby uzupełnić lat/lng i otworzyć formularz."
              : "Wybierz tryb dodawania."}
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
              {loadingPoints ? "Ładuję..." : "Odśwież"}
            </button>

            <button
              onClick={() => {
                setSelectedPointId(null);
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

          {selectedPoint ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              <button
                onClick={() => {
                  if (selectedPoint) togglePointPriority(selectedPoint);
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
                    color: selectedPoint?.priority
                      ? "rgba(255,255,255,0.65)"
                      : "rgba(245,158,11,0.95)",
                    textShadow: selectedPoint?.priority ? "none" : "0 0 12px rgba(245,158,11,0.25)",
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
                onClick={deleteSelectedDevice}
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

          {/* LISTA URZĄDZEŃ — nagłówek + legenda (bez zmiany fontu) */}
          <div style={{ marginBottom: 10 }}>
            <div
  style={{
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  }}
>
  <div style={{ fontWeight: 900 }}>Lista urządzeń</div>

  <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
    {/* 🔔 Overdue chip */}
    {overdueCount > 0 ? (
  <button
    type="button"
    onClick={() => setOnlyOverdue((v) => !v)}
    title={onlyOverdue ? "Pokaż wszystkie" : "Pokaż tylko po terminie kalibracji"}
    style={{
      all: "unset",
      cursor: "pointer",
      display: "inline-flex",
      alignItems: "center",
    }}
  >
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 22,
        height: 22,
        padding: "0 8px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 900,
        color: "#111827",
        background: "rgba(239,68,68,0.95)",
        border: onlyOverdue
          ? "2px solid rgba(255,255,255,0.75)"
          : "1px solid rgba(239,68,68,0.65)",
        boxShadow: onlyOverdue ? "0 0 0 3px rgba(239,68,68,0.18)" : "none",
        userSelect: "none",
      }}
    >
      🔔 {overdueCount}
    </span>
  </button>
) : null}

    {/* istniejąca legenda "Ważne" */}
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontSize: 11,
        color: MUTED,
        whiteSpace: "nowrap",
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
      Ważne
    </div>
  </div>
</div>


            {/* legenda POD tytułem (prosta i kompaktowa) */}
            <div
              style={{
                marginTop: 6,
                display: "flex",
                alignItems: "center",
                gap: 14,
                flexWrap: "wrap",
                fontSize: 12,
                color: "rgba(255,255,255,0.65)",
              }}
            >
              <div style={{ fontSize: 11, color: MUTED, display: "flex", gap: 12, flexWrap: "wrap" }}>
              <span>📦 Na magazynie</span>
              <span>📍 W terenie</span>
              <span>🛠️ W serwisie</span>
            </div>
            </div>
          </div>

          <input
            className="projectSearch"
            value={projectQuery}
            onChange={(e) => setProjectQuery(e.target.value)}
            placeholder="Szukaj urządzenia… (wpisz nazwę lub słowo klucz)"
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
              {filteredDevicesSearch.map((x) => {
                const selected = x.id === selectedPointId;

                return (
                  <div
                    key={`device-${x.id}`}
                    onClick={() => {
                      setSelectedPointId(x.id);

                      if (x.in_storage) {
                        setEditOpen(true);
                      } else {
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
    {x.in_storage
      ? x.warehouse === "SERWIS"
        ? "🛠️"
        : "📦"
      : "📍"}
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
                        {x.title || `Urządzenie #${x.id}`}
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

              {filteredDevicesSearch.length === 0 ? (
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
  className={`${addMode === "point" ? "tmPickMode" : ""} ${
    addMode === "point" && isDraggingMap ? "tmPickModeDragging" : ""
  }`}
  style={{
    width: "100%",
    height: "100%",
    position: "relative",
  }}
>
  {addMode === "point" ? <div ref={crosshairRef} className="tmCursorCrosshair" style={{ display: "none" }} /> : null}

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

  {addMode === "point" ? (
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
        backgroundImage: "radial-gradient(700px 420px at 20% 10%, rgba(255,255,255,0.10), transparent 60%)",
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
            <span style={{ whiteSpace: "nowrap" }}>Tryb: Urządzenie</span>
            <span style={{ fontSize: 11, color: MUTED, fontWeight: 800, opacity: 0.9 }}>
              Kliknij na mapie, aby dodać marker.
            </span>
          </div>

          <div style={{ fontSize: 11, color: MUTED, fontWeight: 700, opacity: 0.85 }}>
            Po dodaniu urządzenia tryb wyłączy się automatycznie.
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          <button
            onClick={() => setAddMode("none")}
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
        backgroundImage: "radial-gradient(500px 300px at 20% 10%, rgba(255,255,255,0.10), transparent 60%)",
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
    gap: 10,
  }}
>
  <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
    <span>Rodzaje urządzeń</span>
  </div>

  <span style={{ fontSize: 12, color: MUTED, flexShrink: 0 }}>
    {filteredPoints.length}/{points.length} {filtersOpen ? "▾" : "▸"}
  </span>
</div>

      {filtersOpen ? (
        <div style={{ padding: "8px 12px 12px", display: "grid", gap: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {DEVICE_TYPES.map((t) => (
              <label
                key={t.value}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  cursor: "pointer",
                  opacity: visibleTypes[t.value] ? 1 : 0.55,
                  userSelect: "none",
                  padding: "8px 10px",
                  borderRadius: 12,
                  border: `1px solid ${BORDER}`,
                  background: "rgba(255,255,255,0.04)",
                }}
              >
                <input
                  type="checkbox"
                  checked={visibleTypes[t.value]}
                  onChange={() => setVisibleTypes((s) => ({ ...s, [t.value]: !s[t.value] }))}
                  style={{ transform: "scale(0.95)" }}
                />
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 999,
                    background: typeColor(t.value),
                    flexShrink: 0,
                  }}
                />
                <span style={{ fontWeight: 800, fontSize: 12 }}>{t.label}</span>
                <span style={{ marginLeft: "auto", fontSize: 12, color: MUTED }}>{counts[t.value]}</span>
              </label>
            ))}
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={showAllTypes}
              style={{
                padding: "8px 10px",
                borderRadius: 10,
                border: `1px solid ${BORDER}`,
                background: "rgba(255,255,255,0.08)",
                color: TEXT_LIGHT,
                cursor: "pointer",
                fontWeight: 800,
                fontSize: 12,
              }}
            >
              Pokaż wszystko
            </button>

            <button
              onClick={hideAllTypes}
              style={{
                padding: "8px 10px",
                borderRadius: 10,
                border: `1px solid ${BORDER}`,
                background: "rgba(255,255,255,0.05)",
                color: TEXT_LIGHT,
                cursor: "pointer",
                fontWeight: 800,
                fontSize: 12,
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
      visible={!!selectedPoint}
      kind={"points"}
      entity={selectedPoint}
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
              setSelectedPointId(null);
              setEditOpen(false);
            }}
          />

          <MapRefSetter
  onReady={(map) => {
    mapRef.current = map;

    // zdejmij poprzednie (HMR / ponowny mount)
    try {
      if (map.__tm_dragStart) map.off("dragstart", map.__tm_dragStart);
      if (map.__tm_dragEnd) map.off("dragend", map.__tm_dragEnd);
    } catch {}

    const handleDragStart = () => setIsDraggingMap(true);
    const handleDragEnd = () => setIsDraggingMap(false);

    map.on("dragstart", handleDragStart);
    map.on("dragend", handleDragEnd);

    map.__tm_dragStart = handleDragStart;
    map.__tm_dragEnd = handleDragEnd;
  }}
/>
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

          <ClickHandler
              enabled={addMode === "point"} 
              onPick={pickLocationFromMap} 
          />

          {/* URZĄDZENIA */}
{/* URZĄDZENIA */}
{filteredPoints
  .filter((pt) => !toBool(pt.in_storage))
  .map((pt) => {
    const lat = toNumCoord(pt.lat);
    const lng = toNumCoord(pt.lng);

    // jeśli brak poprawnych współrzędnych – nie renderuj markera
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    const cal = calibrationMeta(pt);

const variant =
  cal.tone === "overdue"
    ? "overdue"
    : cal.tone === "warn"
    ? "warn"
    : "base";

const iconKey = `${pt.status}__${variant}`;
const baseKey = `${pt.status}__base`;

    return (
      <Marker
        key={`pt-${pt.id}`}
        position={[lat, lng]}
        icon={pinIcons[iconKey] || pinIcons[baseKey] || pinIcons.__default}
        bubblingMouseEvents={false}
        ref={(ref) => {
          if (ref) markerRefs.current[pt.id] = ref;
        }}
        eventHandlers={{
          click: (e) => {
            suppressNextMapClickRef.current = true;
            setTimeout(() => (suppressNextMapClickRef.current = false), 0);

            setSelectedPointId(pt.id);
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
                  {pt.title || `Urządzenie #${pt.id}`}
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
                  value={deviceChance({
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

            {(() => {
              const cal2 = calibrationMeta(pt);
              const pill = calibrationPillStyle(cal2.tone, BORDER);

              return (
                <div
                  style={{
                    fontSize: 11,
                    color: MUTED,
                    marginTop: 6,
                    display: "flex",
                    gap: 8,
                    alignItems: "center",
                  }}
                >
                  <span>Kalibracja:</span>

                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "3px 8px",
                      borderRadius: 999,
                      fontWeight: 900,
                      fontSize: 11,
                      ...pill,
                    }}
                    title={
                      cal2.tone === "overdue"
                        ? "Kalibracja po terminie"
                        : cal2.tone === "warn"
                        ? "Kalibracja wkrótce"
                        : cal2.tone === "ok"
                        ? "Kalibracja OK"
                        : "Brak danych kalibracji"
                    }
                  >
                    {cal2.tone === "overdue"
                      ? "🔴"
                      : cal2.tone === "warn"
                      ? "🟠"
                      : cal2.tone === "ok"
                      ? "🟢"
                      : "—"}
                    {cal2.label}
                  </span>
                </div>
              );
            })()}

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
              <button
  type="button"
  onMouseDown={(e) => {
    e.preventDefault();
    e.stopPropagation();
  }}
  onClick={(e) => {
    e.preventDefault();
    e.stopPropagation();

    // zgaś następny "klik mapy" (ten sam tick)
    suppressNextMapClickRef.current = true;
    setTimeout(() => (suppressNextMapClickRef.current = false), 0);

    setEditOpen(true);
  }}
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
  Właściwości
</button>
            </div>
          </div>
        </Popup>
      </Marker>
    );
  })}

        </MapContainer>

        <EditDeviceModal
          open={editOpen}
          device={
            selectedPoint
              ? { ...selectedPoint, acquired: isAcquired("points", selectedPoint.id) }
              : null
          }
          onClose={() => setEditOpen(false)}
          onSave={saveEditedDevice}
          BORDER={BORDER}
          TEXT_LIGHT={TEXT_LIGHT}
          MUTED={MUTED}
          GLASS_BG={GLASS_BG_DARK}
          WAREHOUSES={WAREHOUSES}
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
<WarehouseModal
  open={warehouseModalOpen}
  warehouseKey={activeWarehouse || ""}
  devices={(activeWarehouse && storageByWarehouse?.[activeWarehouse]) ? storageByWarehouse[activeWarehouse] : []}
  onClose={() => setWarehouseModalOpen(false)}
  onSelectDevice={(d) => {
    setSelectedPointId(d.id);
    setWarehouseModalOpen(false);
    setEditOpen(true);
  }}
  onShowOnMap={(d) => {
    // jeśli kiedyś urządzenia magazynowe dostaną współrzędne, to zadziała:
    setSelectedPointId(d.id);
    setWarehouseModalOpen(false);
    focusPoint(d);
  }}
  BORDER={BORDER}
  TEXT_LIGHT={TEXT_LIGHT}
  MUTED={MUTED}
  GLASS_BG={GLASS_BG_DARK}
  GLASS_SHADOW={GLASS_SHADOW}
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