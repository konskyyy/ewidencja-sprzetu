const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

// ✅ magazyny (w tym SERWIS)
const WAREHOUSES = new Set(["GEO_BB", "GEO_OM", "GEO_LD", "SERWIS"]);

const app = express();
app.use(express.json({ limit: "2mb" }));

/**
 * CORS:
 * Render env:
 * CORS_ORIGIN = https://twoj-frontend.vercel.app,https://inne...
 */
const allowedOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // curl/postman
      if (allowedOrigins.includes(origin)) return cb(null, true);
      if (origin.endsWith(".vercel.app")) return cb(null, true); // preview Vercel
      return cb(new Error("CORS blocked: " + origin));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: false,
  })
);

app.options("*", cors());

const PORT = process.env.PORT || 3001;
const DATABASE_URL = process.env.DATABASE_URL;
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

if (!DATABASE_URL) {
  console.error("❌ DATABASE_URL is missing");
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

/**
 * Minimalne zabezpieczenie kompatybilności:
 * - dodaje kolumny (jeśli ich nie ma)
 */
async function ensureSchema() {
  try {
    await pool.query(`
      ALTER TABLE assets
      ADD COLUMN IF NOT EXISTS priority boolean DEFAULT false
    `);

    await pool.query(`
      ALTER TABLE assets
      ADD COLUMN IF NOT EXISTS in_storage boolean DEFAULT false
    `);

    await pool.query(`
      ALTER TABLE assets
      ADD COLUMN IF NOT EXISTS warehouse text
    `);
  } catch (e) {
    console.error("ensureSchema error:", e);
  }
}

// ===== HEALTH / DEBUG =====
app.get("/api/health", (req, res) => res.json({ ok: true }));
app.get("/api/version", (req, res) =>
  res.json({ version: "assets-no-director-winner-v1", ts: Date.now() })
);

// (opcjonalnie) surowe assets poza /api
app.get("/assets", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        id, name, type, status, quantity, unit, serial_number,
        lat, lng, notes, created_at, updated_at,
        COALESCE(priority,false) AS priority,
        COALESCE(in_storage,false) AS in_storage,
        warehouse
      FROM assets
      ORDER BY id DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error("GET /assets error:", err);
    res.status(500).json({ error: "DB error" });
  }
});

// ===== AUTH =====
function signToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET, {
    expiresIn: "30d",
  });
}

function authRequired(req, res, next) {
  const h = req.headers.authorization || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return res.status(401).json({ error: "Brak tokenu" });

  try {
    const payload = jwt.verify(m[1], JWT_SECRET);
    req.user = { id: payload.sub, email: payload.email };
    next();
  } catch (e) {
    console.error("AUTH TOKEN ERROR:", e);
    return res.status(401).json({ error: "Niepoprawny token" });
  }
}

// --- magazyn / współrzędne ---
function parseInStorage(v) {
  return v === true || v === "true" || v === 1 || v === "1";
}

function normalizeWarehouse(v) {
  if (v === null || v === undefined) return "";
  return String(v).trim().toUpperCase();
}

/**
 * Zwraca zawsze spójny zestaw pól:
 * - jeśli magazyn: { in_storage:true, warehouse:<enum>, lat:null, lng:null }
 * - jeśli poza:   { in_storage:false, warehouse:null, lat:<number>, lng:<number> }
 */
function normalizeStorage(body) {
  const in_storage = parseInStorage(body?.in_storage);

  // ✅ normalizacja na UPPERCASE (żeby nie wywalić się na "serwis" vs "SERWIS")
  const warehouse = normalizeWarehouse(body?.warehouse);

  // MAGAZYN
  if (in_storage) {
    const wh = warehouse || "GEO_BB"; // domyślny
    if (!WAREHOUSES.has(wh)) {
      const err = new Error("Niepoprawny magazyn.");
      err.status = 400;
      throw err;
    }
    return { in_storage: true, warehouse: wh, lat: null, lng: null };
  }

  // POZA MAGAZYNEM -> lat/lng obowiązkowe
  const lat = Number(body?.lat);
  const lng = Number(body?.lng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    const err = new Error("Podaj poprawne współrzędne lat/lng.");
    err.status = 400;
    throw err;
  }

  return { in_storage: false, warehouse: null, lat, lng };
}

app.post("/api/auth/register", (req, res) => {
  return res.status(403).json({ error: "Rejestracja jest wyłączona" });
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    const q = await pool.query(
      "SELECT id, email, password_hash FROM users WHERE email=$1",
      [email]
    );

    const user = q.rows[0];
    if (!user) return res.status(401).json({ error: "Złe dane" });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: "Złe dane" });

    const token = signToken(user);
    res.json({ token, user: { id: user.id, email: user.email } });
  } catch (e) {
    console.error("LOGIN DB ERROR:", e);
    return res.status(500).json({ error: "DB error", details: String(e) });
  }
});

app.get("/api/auth/me", authRequired, async (req, res) => {
  res.json({ user: { id: req.user.id, email: req.user.email } });
});

// ===== ASSETS API =====
app.get("/api/assets", authRequired, async (req, res) => {
  try {
    const q = await pool.query(`
      SELECT
        id, name, type, status, quantity, unit, serial_number,
        lat, lng, notes, created_at, updated_at,
        COALESCE(priority,false) AS priority,
        COALESCE(in_storage,false) AS in_storage,
        warehouse
      FROM assets
      ORDER BY COALESCE(priority,false) DESC, id DESC
    `);
    res.json(q.rows);
  } catch (e) {
    console.error("GET ASSETS ERROR:", e);
    res.status(500).json({ error: "DB error", details: String(e) });
  }
});

// ===== POINTS API (adapter: points -> assets) =====
app.get("/api/points", authRequired, async (req, res) => {
  try {
    const q = await pool.query(`
      SELECT
        id,
        name,
        status,
        lat,
        lng,
        notes,
        COALESCE(in_storage,false) AS in_storage,
        warehouse,
        COALESCE(priority,false) AS priority
      FROM assets
      ORDER BY COALESCE(priority,false) DESC, id DESC
    `);

    const points = q.rows.map((a) => ({
      id: a.id,
      title: a.name,
      name: a.name,
      note: a.notes ?? "",
      notes: a.notes ?? "",
      status: a.status,
      lat: a.lat,
      lng: a.lng,
      in_storage: a.in_storage === true,
      warehouse: a.warehouse ?? null,
      priority: !!a.priority,
    }));

    res.json(points);
  } catch (e) {
    console.error("GET /api/points (assets adapter) ERROR:", e);
    res.status(500).json({ error: "DB error", details: String(e) });
  }
});

// SET point priority -> assets.priority
app.patch("/api/points/:id/priority", authRequired, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Złe ID" });

    const priority = req.body?.priority;
    if (typeof priority !== "boolean") {
      return res
        .status(400)
        .json({ error: "priority musi być boolean (true/false)" });
    }

    const q = await pool.query(
      `UPDATE assets
       SET priority=$1, updated_at=NOW()
       WHERE id=$2
       RETURNING id, name, status, lat, lng, notes,
                 COALESCE(in_storage,false) AS in_storage,
                 warehouse,
                 COALESCE(priority,false) AS priority`,
      [priority, id]
    );

    const a = q.rows[0];
    if (!a) return res.status(404).json({ error: "Nie znaleziono urządzenia" });

    res.json({
      id: a.id,
      title: a.name,
      name: a.name,
      note: a.notes ?? "",
      notes: a.notes ?? "",
      status: a.status,
      lat: a.lat,
      lng: a.lng,
      in_storage: a.in_storage,
      warehouse: a.warehouse,
      priority: !!a.priority,
    });
  } catch (e) {
    console.error("PATCH POINT PRIORITY (assets) ERROR:", e);
    res.status(500).json({ error: "DB error", details: String(e) });
  }
});

// CREATE point -> INSERT asset
app.post("/api/points", authRequired, async (req, res) => {
  try {
    const body = req.body || {};

    const title = String(body.title || body.name || "Nowe urządzenie").trim();
    const status = String(body.status || "tachimetr").trim();
    const note = String(body.note || body.notes || "");

    const st = normalizeStorage(body);

    const q = await pool.query(
      `
      INSERT INTO assets (name, type, status, lat, lng, notes, in_storage, warehouse, priority)
      VALUES ($1, 'equipment', $2, $3, $4, $5, $6, $7, false)
      RETURNING id, name, status, lat, lng, notes,
                COALESCE(in_storage,false) AS in_storage,
                warehouse,
                COALESCE(priority,false) AS priority
      `,
      [title, status, st.lat, st.lng, note, st.in_storage, st.warehouse]
    );

    const a = q.rows[0];
    res.json({
      id: a.id,
      title: a.name,
      name: a.name,
      status: a.status,
      lat: a.lat,
      lng: a.lng,
      note: a.notes ?? "",
      notes: a.notes ?? "",
      in_storage: a.in_storage,
      warehouse: a.warehouse,
      priority: !!a.priority,
    });
  } catch (e) {
    console.error("CREATE POINT ERROR:", e);
    res.status(e.status || 500).json({ error: String(e.message || e) });
  }
});

// UPDATE point -> UPDATE asset (pojedyncza, docelowa wersja)
app.put("/api/points/:id", authRequired, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Złe ID" });

    const body = req.body || {};

    const title = String(body.title || body.name || "").trim();
    const status = String(body.status || "tachimetr").trim();
    const note = String(body.note || body.notes || "").trim();

    if (!title)
      return res.status(400).json({ error: "Nazwa urządzenia jest wymagana" });

    const st = normalizeStorage(body);

    const q = await pool.query(
      `
      UPDATE assets
      SET name=$1,
          status=$2,
          notes=$3,
          in_storage=$4,
          warehouse=$5,
          lat=$6,
          lng=$7,
          updated_at=NOW()
      WHERE id=$8
      RETURNING id, name, status, lat, lng, notes,
                COALESCE(in_storage,false) AS in_storage,
                warehouse,
                COALESCE(priority,false) AS priority
      `,
      [title, status, note, st.in_storage, st.warehouse, st.lat, st.lng, id]
    );

    const a = q.rows[0];
    if (!a) return res.status(404).json({ error: "Nie znaleziono urządzenia" });

    res.json({
      id: a.id,
      title: a.name,
      name: a.name,
      note: a.notes ?? "",
      notes: a.notes ?? "",
      status: a.status,
      lat: a.lat,
      lng: a.lng,
      in_storage: a.in_storage,
      warehouse: a.warehouse,
      priority: !!a.priority,
    });
  } catch (e) {
    console.error("PUT /api/points/:id ERROR:", e);
    res.status(e.status || 500).json({ error: String(e.message || e) });
  }
});

// DELETE point -> DELETE asset (+ cleanup comments/read) [wersja transakcyjna]
app.delete("/api/points/:id", authRequired, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Złe ID" });

    await pool.query(`DELETE FROM point_comments WHERE point_id=$1`, [id]);
    await pool.query(`DELETE FROM updates_read WHERE kind='points' AND entity_id=$1`, [id]);

    const q = await pool.query(`DELETE FROM assets WHERE id=$1 RETURNING id`, [id]);
    if (!q.rows[0]) return res.status(404).json({ error: "Nie znaleziono urządzenia" });

    res.json({ ok: true, id });
  } catch (e) {
    console.error("DELETE /api/points/:id ERROR:", e);
    res.status(500).json({ error: "DB error", details: String(e) });
  }
});

/**
 * ===== COMMENTS API =====
 * point_comments: point_id traktujemy jako asset_id i sprawdzamy istnienie w assets.
 */
app.get("/api/points/:id/comments", authRequired, async (req, res) => {
  try {
    const pointId = Number(req.params.id);
    if (!Number.isFinite(pointId))
      return res.status(400).json({ error: "Złe ID" });

    const exists = await pool.query("SELECT id FROM assets WHERE id=$1", [
      pointId,
    ]);
    if (!exists.rows[0])
      return res.status(404).json({ error: "Nie znaleziono urządzenia" });

    const q = await pool.query(
      `SELECT id, point_id, user_id, user_email, body, created_at, edited, updated_at
       FROM point_comments
       WHERE point_id=$1
       ORDER BY created_at DESC, id DESC`,
      [pointId]
    );

    res.json(q.rows);
  } catch (e) {
    console.error("GET POINT COMMENTS ERROR:", e);
    res.status(500).json({ error: "DB error", details: String(e) });
  }
});

app.post("/api/points/:id/comments", authRequired, async (req, res) => {
  try {
    const pointId = Number(req.params.id);
    if (!Number.isFinite(pointId))
      return res.status(400).json({ error: "Złe ID" });

    const body = String(req.body.body || "").trim();
    if (!body)
      return res
        .status(400)
        .json({ error: "Treść komentarza jest wymagana" });
    if (body.length > 5000)
      return res
        .status(400)
        .json({ error: "Komentarz za długi (max 5000 znaków)" });

    const exists = await pool.query("SELECT id FROM assets WHERE id=$1", [
      pointId,
    ]);
    if (!exists.rows[0])
      return res.status(404).json({ error: "Nie znaleziono urządzenia" });

    const q = await pool.query(
      `INSERT INTO point_comments (point_id, user_id, user_email, body)
       VALUES ($1,$2,$3,$4)
       RETURNING id, point_id, user_id, user_email, body, created_at, edited, updated_at`,
      [pointId, req.user.id, req.user.email, body]
    );

    res.json(q.rows[0]);
  } catch (e) {
    console.error("ADD POINT COMMENT ERROR:", e);
    res.status(500).json({ error: "DB error", details: String(e) });
  }
});

app.put("/api/points/:id/comments/:commentId", authRequired, async (req, res) => {
  try {
    const pointId = Number(req.params.id);
    const commentId = Number(req.params.commentId);
    if (!Number.isFinite(pointId) || !Number.isFinite(commentId)) {
      return res.status(400).json({ error: "Złe ID" });
    }

    const body = String(req.body.body || "").trim();
    if (!body)
      return res.status(400).json({ error: "Treść komentarza jest wymagana" });
    if (body.length > 5000)
      return res
        .status(400)
        .json({ error: "Komentarz za długi (max 5000 znaków)" });

    const cur = await pool.query(
      `SELECT id, point_id, user_id
       FROM point_comments
       WHERE id=$1 AND point_id=$2`,
      [commentId, pointId]
    );

    const row = cur.rows[0];
    if (!row) return res.status(404).json({ error: "Nie znaleziono komentarza" });

    if (Number(row.user_id) !== Number(req.user.id)) {
      return res
        .status(403)
        .json({ error: "Brak uprawnień (to nie jest Twój komentarz)" });
    }

    const q = await pool.query(
      `UPDATE point_comments
       SET body=$1, edited=true, updated_at=NOW()
       WHERE id=$2
       RETURNING id, point_id, user_id, user_email, body, created_at, edited, updated_at`,
      [body, commentId]
    );

    res.json(q.rows[0]);
  } catch (e) {
    console.error("EDIT POINT COMMENT ERROR:", e);
    res.status(500).json({ error: "DB error", details: String(e) });
  }
});

app.delete(
  "/api/points/:id/comments/:commentId",
  authRequired,
  async (req, res) => {
    try {
      const pointId = Number(req.params.id);
      const commentId = Number(req.params.commentId);
      if (!Number.isFinite(pointId) || !Number.isFinite(commentId)) {
        return res.status(400).json({ error: "Złe ID" });
      }

      const cur = await pool.query(
        `SELECT id, point_id, user_id
         FROM point_comments
         WHERE id=$1 AND point_id=$2`,
        [commentId, pointId]
      );

      const row = cur.rows[0];
      if (!row) return res.status(404).json({ error: "Nie znaleziono komentarza" });

      if (Number(row.user_id) !== Number(req.user.id)) {
        return res
          .status(403)
          .json({ error: "Brak uprawnień (to nie jest Twój komentarz)" });
      }

      await pool.query(`DELETE FROM point_comments WHERE id=$1 AND point_id=$2`, [
        commentId,
        pointId,
      ]);

      res.json({ ok: true, id: commentId });
    } catch (e) {
      console.error("DELETE POINT COMMENT ERROR:", e);
      res.status(500).json({ error: "DB error", details: String(e) });
    }
  }
);

/**
 * ===== UPDATES FEED =====
 * Powiadomienia TYLKO dla urządzeń (points -> assets).
 */
app.get("/api/updates/recent", authRequired, async (req, res) => {
  try {
    const rawLimit = Number(req.query.limit);
    const limit = Number.isFinite(rawLimit)
      ? Math.max(1, Math.min(100, rawLimit))
      : 30;

    const userId = req.user.id;

    const sql = `
      with feed as (
        select
          pc.id as id,
          'points'::text as kind,
          pc.point_id as entity_id,
          a.name as entity_title,
          pc.user_id,
          pc.user_email,
          pc.body,
          pc.created_at,
          pc.edited
        from point_comments pc
        join assets a on a.id = pc.point_id
      )
      select f.*
      from feed f
      where not exists (
        select 1
        from updates_read ur
        where ur.user_id = $1
          and ur.kind = f.kind
          and ur.entity_id = f.entity_id
          and ur.comment_id = f.id
      )
      order by f.created_at desc
      limit $2;
    `;

    const q = await pool.query(sql, [userId, limit]);
    res.json(q.rows);
  } catch (e) {
    console.error("GET UPDATES RECENT ERROR:", e);
    res.status(500).json({ error: "DB error", details: String(e) });
  }
});

app.post("/api/updates/read-all", authRequired, async (req, res) => {
  try {
    const userId = req.user.id;

    const rawLimit = Number(req.query.limit);
    const limit = Number.isFinite(rawLimit)
      ? Math.max(1, Math.min(500, rawLimit))
      : 300;

    const sql = `
      with feed as (
        select
          pc.id as comment_id,
          'points'::text as kind,
          pc.point_id as entity_id
        from point_comments pc
      ),
      unread as (
        select f.*
        from feed f
        where not exists (
          select 1
          from updates_read ur
          where ur.user_id = $1
            and ur.kind = f.kind
            and ur.entity_id = f.entity_id
            and ur.comment_id = f.comment_id
        )
        limit $2
      )
      insert into updates_read (user_id, kind, entity_id, comment_id)
      select $1, kind, entity_id, comment_id
      from unread
      on conflict (user_id, kind, entity_id, comment_id) do nothing
      returning id;
    `;

    const q = await pool.query(sql, [userId, limit]);
    res.json({ ok: true, inserted: q.rowCount });
  } catch (e) {
    console.error("POST UPDATES READ-ALL ERROR:", e);
    res.status(500).json({ error: "DB error", details: String(e) });
  }
});

/**
 * body: { kind: 'points', entity_id: number, comment_id: number }
 */
app.post("/api/updates/read", authRequired, async (req, res) => {
  try {
    const kind = String(req.body?.kind || "");
    const entityId = Number(req.body?.entity_id);
    const commentId = Number(req.body?.comment_id);

    if (kind !== "points") {
      return res.status(400).json({ error: "kind musi być points" });
    }
    if (!Number.isFinite(entityId) || !Number.isFinite(commentId)) {
      return res.status(400).json({ error: "Złe entity_id/comment_id" });
    }

    const q = await pool.query(
      `
      insert into updates_read (user_id, kind, entity_id, comment_id)
      values ($1,$2,$3,$4)
      on conflict (user_id, kind, entity_id, comment_id)
      do update set read_at = now()
      returning user_id, kind, entity_id, comment_id, read_at
      `,
      [req.user.id, kind, entityId, commentId]
    );

    res.json({ ok: true, row: q.rows[0] });
  } catch (e) {
    console.error("POST UPDATES READ ERROR:", e);
    res.status(500).json({ error: "DB error", details: String(e) });
  }
});

// ===== START =====
(async () => {
  await ensureSchema();

  app.use((req, res) => {
    res.status(404).json({ error: "Not Found", path: req.path, method: req.method });
  });

  app.listen(PORT, () => {
    console.log(`Backend działa na porcie ${PORT}`);
    console.log("CORS_ORIGIN:", process.env.CORS_ORIGIN);
    console.log("DATABASE_URL set:", !!DATABASE_URL);
  });
})();
