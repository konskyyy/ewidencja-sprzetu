const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const WAREHOUSES = ["GEO_BB", "GEO_OM", "GEO_LD"];

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
 * - dodaje kolumnę priority do assets (jeśli jej nie ma)
 */
async function ensureSchema() {
  try {
    await pool.query(`
      ALTER TABLE assets
      ADD COLUMN IF NOT EXISTS priority boolean DEFAULT false
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
      SELECT id, name, type, status, quantity, unit, serial_number, lat, lng, notes, created_at, updated_at,
             COALESCE(priority,false) AS priority
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
function normalizeStorage(body) {
  function parseInStorage(body) {
  return body?.in_storage === true || body?.in_storage === "true" || body?.in_storage === 1;
}
  const warehouse = (body.warehouse ?? "").toString().trim();

  if (in_storage) {
    if (!WAREHOUSES.includes(warehouse)) {
      const err = new Error("Niepoprawny magazyn.");
      err.status = 400;
      throw err;
    }
    return {
      in_storage: true,
      warehouse,
      lat: null,
      lng: null,
    };
  }

  // nie magazyn -> lat/lng obowiązkowe
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    const err = new Error("Podaj poprawne współrzędne lat/lng.");
    err.status = 400;
    throw err;
  }

  return {
    in_storage: false,
    warehouse: null,
    lat,
    lng,
  };
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

// ===== ASSETS API (docelowe) =====
app.get("/api/assets", authRequired, async (req, res) => {
  try {
    const q = await pool.query(`
      SELECT id, name, type, status, quantity, unit, serial_number, lat, lng, notes,
             created_at, updated_at, COALESCE(priority,false) AS priority
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
        COALESCE(priority,false) AS priority
      FROM assets
      ORDER BY COALESCE(priority,false) DESC, id DESC
    `);

    const points = q.rows.map((a) => ({
      id: a.id,
      title: a.name,
      name: a.name,
      // ⬇️ legacy pola zostawiamy, ale NIE zapisujemy ich do DB
      director: "",
      winner: "",
      note: a.notes ?? "",
      notes: a.notes ?? "",
      status: a.status,
      lat: a.lat,
      lng: a.lng,
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
       RETURNING id, name, status, lat, lng, notes, COALESCE(priority,false) AS priority`,
      [priority, id]
    );

    const a = q.rows[0];
    if (!a) return res.status(404).json({ error: "Nie znaleziono urządzenia" });

    res.json({
      id: a.id,
      title: a.name,
      name: a.name,
      director: "",
      winner: "",
      note: a.notes ?? "",
      notes: a.notes ?? "",
      status: a.status,
      lat: a.lat,
      lng: a.lng,
      priority: !!a.priority,
    });
  } catch (e) {
    console.error("PATCH POINT PRIORITY (assets) ERROR:", e);
    res.status(500).json({ error: "DB error", details: String(e) });
  }
});

// CREATE point -> INSERT asset (BEZ director/winner)
app.post("/api/points", (req,res)=> {
  const in_storage = parseInStorage(req.body);
});
  try {
    const body = req.body || {};

    const title = String(body.title || body.name || "Nowe urządzenie");
    const status = String(body.status || "tachimetr");
    const note = String(body.note || body.notes || "");

    const in_storage =
      body.in_storage === true ||
      body.in_storage === "true" ||
      body.in_storage === 1;

    const warehouse = in_storage
      ? String(body.warehouse || "GEO_BB")
      : null;

    let lat = null;
    let lng = null;

    if (!in_storage) {
      lat = Number(body.lat);
      lng = Number(body.lng);

      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return res.status(400).json({
          error: "Brak poprawnych współrzędnych",
        });
      }
    }

    const q = await pool.query(
      `
      INSERT INTO assets (
        name,
        type,
        status,
        lat,
        lng,
        notes,
        in_storage,
        warehouse,
        priority
      )
      VALUES ($1, 'equipment', $2, $3, $4, $5, $6, $7, false)
      RETURNING
        id,
        name,
        status,
        lat,
        lng,
        notes,
        in_storage,
        warehouse,
        COALESCE(priority,false) AS priority
      `,
      [
        title,
        status,
        lat,
        lng,
        note,
        in_storage,
        warehouse,
      ]
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
    res.status(500).json({ error: "DB error", details: String(e) });
  }
});

/**
 * ===== COMMENTS API =====
 * point_comments: point_id traktujemy jako asset_id i sprawdzamy istnienie w assets.
 */

// GET point comments
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

// ADD point comment
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

// EDIT point comment
app.put("/api/points/:id/comments/:commentId", authRequired, async (req, res) => {
  try {
    const pointId = Number(req.params.id);
    const commentId = Number(req.params.commentId);
    if (!Number.isFinite(pointId) || !Number.isFinite(commentId)) {
      return res.status(400).json({ error: "Złe ID" });
    }

    const body = String(req.body.body || "").trim();
    if (!body) return res.status(400).json({ error: "Treść komentarza jest wymagana" });
    if (body.length > 5000)
      return res.status(400).json({ error: "Komentarz za długi (max 5000 znaków)" });

    const cur = await pool.query(
      `SELECT id, point_id, user_id
       FROM point_comments
       WHERE id=$1 AND point_id=$2`,
      [commentId, pointId]
    );

    const row = cur.rows[0];
    if (!row) return res.status(404).json({ error: "Nie znaleziono komentarza" });

    if (Number(row.user_id) !== Number(req.user.id)) {
      return res.status(403).json({ error: "Brak uprawnień (to nie jest Twój komentarz)" });
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

// DELETE point comment
app.delete("/api/points/:id/comments/:commentId", authRequired, async (req, res) => {
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
      return res.status(403).json({ error: "Brak uprawnień (to nie jest Twój komentarz)" });
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
});

/**
 * ===== UPDATES FEED =====
 * Powiadomienia TYLKO dla urządzeń (points -> assets).
 * Nie dotykamy dziennika, tylko feed aktualizacji.
 */
app.get("/api/updates/recent", authRequired, async (req, res) => {
  try {
    const rawLimit = Number(req.query.limit);
    const limit = Number.isFinite(rawLimit)
      ? Math.max(1, Math.min(100, rawLimit))
      : 30;

    const userId = req.user.id;

    // FEED TYLKO DLA URZĄDZEŃ (points -> assets через point_comments)
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



app.post("/api/updates/read", authRequired, async (req, res) => {
  try {
    const kind = String(req.body?.kind || "");
    const entityId = Number(req.body?.entity_id);
    const commentId = Number(req.body?.comment_id);

    if (kind !== "points" && kind !== "tunnels") {
      return res.status(400).json({ error: "kind musi być points albo tunnels" });
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

  app.listen(PORT, () => {
    console.log(`Backend działa na porcie ${PORT}`);
    console.log("CORS_ORIGIN:", process.env.CORS_ORIGIN);
    console.log("DATABASE_URL set:", !!DATABASE_URL);
  });
})();
