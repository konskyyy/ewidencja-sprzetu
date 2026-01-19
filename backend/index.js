const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();
app.use(express.json({ limit: "2mb" }));

/**
 * CORS:
 * Ustaw w Render env:
 * CORS_ORIGIN = https://tomasz-tenders-map.vercel.app
 * (opcjonalnie: dodaj też localhost i inne domeny po przecinku)
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

// ===== HEALTH =====
app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

// ===== VERSION (debug deploy check) =====
app.get("/api/version", (req, res) => {
  res.json({ version: "priority-feed-v1", ts: Date.now() });
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

// ===== REGISTER (disabled) =====
app.post("/api/auth/register", (req, res) => {
  return res.status(403).json({ error: "Rejestracja jest wyłączona" });
});

// ===== LOGIN =====
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

app.get("/api/auth/me", authRequired, (req, res) => {
  res.json({ user: req.user });
});

/**
 * ===== POINTS API =====
 */

// GET all points (priority first)
app.get("/api/points", authRequired, async (req, res) => {
  try {
    const q = await pool.query(
      `SELECT id, title, director, winner, note, status, lat, lng, COALESCE(priority,false) AS priority
       FROM points
       ORDER BY COALESCE(priority,false) DESC, id DESC`
    );
    res.json(q.rows);
  } catch (e) {
    console.error("GET POINTS ERROR:", e);
    res.status(500).json({ error: "DB error", details: String(e) });
  }
});

// SET point priority (true/false)
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
      `UPDATE points
       SET priority=$1
       WHERE id=$2
       RETURNING id, title, director, winner, note, status, lat, lng, COALESCE(priority,false) AS priority`,
      [priority, id]
    );

    const row = q.rows[0];
    if (!row) return res.status(404).json({ error: "Nie znaleziono punktu" });

    res.json(row);
  } catch (e) {
    console.error("PATCH POINT PRIORITY ERROR:", e);
    res.status(500).json({ error: "DB error", details: String(e) });
  }
});

// CREATE point
app.post("/api/points", authRequired, async (req, res) => {
  try {
    const title = String(req.body.title || "Nowy punkt");
    const director = String(req.body.director || "");
    const winner = String(req.body.winner || "");
    const note = String(req.body.note || "");
    const status = String(req.body.status || "planowany");
    const lat = Number(req.body.lat);
    const lng = Number(req.body.lng);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: "Brak poprawnych współrzędnych" });
    }

    const q = await pool.query(
      `INSERT INTO points (title, director, winner, note, status, lat, lng)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, title, director, winner, note, status, lat, lng, COALESCE(priority,false) AS priority`,
      [title, director, winner, note, status, lat, lng]
    );

    res.json(q.rows[0]);
  } catch (e) {
    console.error("CREATE POINT ERROR:", e);
    res.status(500).json({ error: "DB error", details: String(e) });
  }
});

// UPDATE point
app.put("/api/points/:id", authRequired, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Złe ID" });

    const title = String(req.body.title || "");
    const director = String(req.body.director || "");
    const winner = String(req.body.winner || "");
    const note = String(req.body.note || "");
    const status = String(req.body.status || "planowany");

    const q = await pool.query(
      `UPDATE points
       SET title=$1, director=$2, winner=$3, note=$4, status=$5
       WHERE id=$6
       RETURNING id, title, director, winner, note, status, lat, lng, COALESCE(priority,false) AS priority`,
      [title, director, winner, note, status, id]
    );

    const row = q.rows[0];
    if (!row) return res.status(404).json({ error: "Nie znaleziono punktu" });

    res.json(row);
  } catch (e) {
    console.error("UPDATE POINT ERROR:", e);
    res.status(500).json({ error: "DB error", details: String(e) });
  }
});

// DELETE point
app.delete("/api/points/:id", authRequired, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Złe ID" });

    const q = await pool.query(`DELETE FROM points WHERE id=$1 RETURNING id`, [
      id,
    ]);

    const row = q.rows[0];
    if (!row) return res.status(404).json({ error: "Nie znaleziono punktu" });

    res.json({ ok: true, id: row.id });
  } catch (e) {
    console.error("DELETE POINT ERROR:", e);
    res.status(500).json({ error: "DB error", details: String(e) });
  }
});

/**
 * ===== TUNNELS API =====
 */

// GET all tunnels (priority first)
app.get("/api/tunnels", authRequired, async (req, res) => {
  try {
    const q = await pool.query(
      `SELECT id, name, status, note, path, COALESCE(priority,false) AS priority
       FROM tunnels
       ORDER BY COALESCE(priority,false) DESC, id DESC`
    );
    res.json(q.rows);
  } catch (e) {
    console.error("GET TUNNELS ERROR:", e);
    res.status(500).json({ error: "DB error", details: String(e) });
  }
});

// SET tunnel priority (true/false)
app.patch("/api/tunnels/:id/priority", authRequired, async (req, res) => {
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
      `UPDATE tunnels
       SET priority=$1
       WHERE id=$2
       RETURNING id, name, status, note, path, COALESCE(priority,false) AS priority`,
      [priority, id]
    );

    const row = q.rows[0];
    if (!row) return res.status(404).json({ error: "Nie znaleziono tunelu" });

    res.json(row);
  } catch (e) {
    console.error("PATCH TUNNEL PRIORITY ERROR:", e);
    res.status(500).json({ error: "DB error", details: String(e) });
  }
});

// CREATE tunnel
app.post("/api/tunnels", authRequired, async (req, res) => {
  try {
    const name = String(req.body.name || "Nowy tunel");
    const status = String(req.body.status || "planowany");
    const note = String(req.body.note || "");
    const path = req.body.path;

    if (!Array.isArray(path) || path.length < 2) {
      return res
        .status(400)
        .json({ error: "Tunel musi mieć co najmniej 2 punkty" });
    }

    for (const p of path) {
      const lat = Number(p?.lat);
      const lng = Number(p?.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return res
          .status(400)
          .json({ error: "Niepoprawne współrzędne w path" });
      }
    }

    const q = await pool.query(
      `INSERT INTO tunnels (name, status, note, path)
       VALUES ($1,$2,$3,$4::jsonb)
       RETURNING id, name, status, note, path, COALESCE(priority,false) AS priority`,
      [name, status, note, JSON.stringify(path)]
    );

    res.json(q.rows[0]);
  } catch (e) {
    console.error("CREATE TUNNEL ERROR:", e);
    res.status(500).json({ error: "DB error", details: String(e) });
  }
});

// UPDATE tunnel (meta + path)
app.put("/api/tunnels/:id", authRequired, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Złe ID" });

    const name = String(req.body.name || "Nowy tunel");
    const status = String(req.body.status || "planowany");
    const note = String(req.body.note || "");
    const path = req.body.path;

    if (!Array.isArray(path) || path.length < 2) {
      return res
        .status(400)
        .json({ error: "Tunel musi mieć co najmniej 2 punkty" });
    }

    const q = await pool.query(
      `UPDATE tunnels
       SET name=$1, status=$2, note=$3, path=$4::jsonb
       WHERE id=$5
       RETURNING id, name, status, note, path, COALESCE(priority,false) AS priority`,
      [name, status, note, JSON.stringify(path), id]
    );

    const row = q.rows[0];
    if (!row) return res.status(404).json({ error: "Nie znaleziono tunelu" });

    res.json(row);
  } catch (e) {
    console.error("UPDATE TUNNEL ERROR:", e);
    res.status(500).json({ error: "DB error", details: String(e) });
  }
});

// DELETE tunnel
app.delete("/api/tunnels/:id", authRequired, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Złe ID" });

    const q = await pool.query(
      `DELETE FROM tunnels WHERE id=$1 RETURNING id`,
      [id]
    );

    const row = q.rows[0];
    if (!row) return res.status(404).json({ error: "Nie znaleziono tunelu" });

    res.json({ ok: true, id: row.id });
  } catch (e) {
    console.error("DELETE TUNNEL ERROR:", e);
    res.status(500).json({ error: "DB error", details: String(e) });
  }
});

/**
 * ===== COMMENTS API =====
 * point_comments, tunnel_comments
 */

// GET point comments
app.get("/api/points/:id/comments", authRequired, async (req, res) => {
  try {
    const pointId = Number(req.params.id);
    if (!Number.isFinite(pointId))
      return res.status(400).json({ error: "Złe ID" });

    const exists = await pool.query("SELECT id FROM points WHERE id=$1", [
      pointId,
    ]);
    if (!exists.rows[0])
      return res.status(404).json({ error: "Nie znaleziono punktu" });

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

    const exists = await pool.query("SELECT id FROM points WHERE id=$1", [
      pointId,
    ]);
    if (!exists.rows[0])
      return res.status(404).json({ error: "Nie znaleziono punktu" });

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

// EDIT point comment (only author)
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

// DELETE point comment (only author)
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
});

// GET tunnel comments
app.get("/api/tunnels/:id/comments", authRequired, async (req, res) => {
  try {
    const tunnelId = Number(req.params.id);
    if (!Number.isFinite(tunnelId))
      return res.status(400).json({ error: "Złe ID" });

    const exists = await pool.query("SELECT id FROM tunnels WHERE id=$1", [
      tunnelId,
    ]);
    if (!exists.rows[0])
      return res.status(404).json({ error: "Nie znaleziono tunelu" });

    const q = await pool.query(
      `SELECT id, tunnel_id, user_id, user_email, body, created_at, edited, updated_at
       FROM tunnel_comments
       WHERE tunnel_id=$1
       ORDER BY created_at DESC, id DESC`,
      [tunnelId]
    );

    res.json(q.rows);
  } catch (e) {
    console.error("GET TUNNEL COMMENTS ERROR:", e);
    res.status(500).json({ error: "DB error", details: String(e) });
  }
});

// ADD tunnel comment
app.post("/api/tunnels/:id/comments", authRequired, async (req, res) => {
  try {
    const tunnelId = Number(req.params.id);
    if (!Number.isFinite(tunnelId))
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

    const exists = await pool.query("SELECT id FROM tunnels WHERE id=$1", [
      tunnelId,
    ]);
    if (!exists.rows[0])
      return res.status(404).json({ error: "Nie znaleziono tunelu" });

    const q = await pool.query(
      `INSERT INTO tunnel_comments (tunnel_id, user_id, user_email, body)
       VALUES ($1,$2,$3,$4)
       RETURNING id, tunnel_id, user_id, user_email, body, created_at, edited, updated_at`,
      [tunnelId, req.user.id, req.user.email, body]
    );

    res.json(q.rows[0]);
  } catch (e) {
    console.error("ADD TUNNEL COMMENT ERROR:", e);
    res.status(500).json({ error: "DB error", details: String(e) });
  }
});

// EDIT tunnel comment (only author)
app.put("/api/tunnels/:id/comments/:commentId", authRequired, async (req, res) => {
  try {
    const tunnelId = Number(req.params.id);
    const commentId = Number(req.params.commentId);
    if (!Number.isFinite(tunnelId) || !Number.isFinite(commentId)) {
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
      `SELECT id, tunnel_id, user_id
       FROM tunnel_comments
       WHERE id=$1 AND tunnel_id=$2`,
      [commentId, tunnelId]
    );

    const row = cur.rows[0];
    if (!row) return res.status(404).json({ error: "Nie znaleziono komentarza" });

    if (Number(row.user_id) !== Number(req.user.id)) {
      return res
        .status(403)
        .json({ error: "Brak uprawnień (to nie jest Twój komentarz)" });
    }

    const q = await pool.query(
      `UPDATE tunnel_comments
       SET body=$1, edited=true, updated_at=NOW()
       WHERE id=$2
       RETURNING id, tunnel_id, user_id, user_email, body, created_at, edited, updated_at`,
      [body, commentId]
    );

    res.json(q.rows[0]);
  } catch (e) {
    console.error("EDIT TUNNEL COMMENT ERROR:", e);
    res.status(500).json({ error: "DB error", details: String(e) });
  }
});

// DELETE tunnel comment (only author)
app.delete("/api/tunnels/:id/comments/:commentId", authRequired, async (req, res) => {
  try {
    const tunnelId = Number(req.params.id);
    const commentId = Number(req.params.commentId);
    if (!Number.isFinite(tunnelId) || !Number.isFinite(commentId)) {
      return res.status(400).json({ error: "Złe ID" });
    }

    const cur = await pool.query(
      `SELECT id, tunnel_id, user_id
       FROM tunnel_comments
       WHERE id=$1 AND tunnel_id=$2`,
      [commentId, tunnelId]
    );

    const row = cur.rows[0];
    if (!row) return res.status(404).json({ error: "Nie znaleziono komentarza" });

    if (Number(row.user_id) !== Number(req.user.id)) {
      return res
        .status(403)
        .json({ error: "Brak uprawnień (to nie jest Twój komentarz)" });
    }

    await pool.query(
      `DELETE FROM tunnel_comments WHERE id=$1 AND tunnel_id=$2`,
      [commentId, tunnelId]
    );

    res.json({ ok: true, id: commentId });
  } catch (e) {
    console.error("DELETE TUNNEL COMMENT ERROR:", e);
    res.status(500).json({ error: "DB error", details: String(e) });
  }
});

/**
 * ===== UPDATES FEED =====
 * GET /api/updates/recent?limit=30
 * Najnowsze wpisy z point_comments + tunnel_comments
 */
/**
 * 
 * 
 * ===== UPDATES FEED =====
 * GET /api/updates/recent?limit=30
 * Zwraca tylko NIEPRZECZYTANE wpisy dla zalogowanego usera
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
          p.title as entity_title,
          pc.user_id,
          pc.user_email,
          pc.body,
          pc.created_at,
          pc.edited
        from point_comments pc
        join points p on p.id = pc.point_id

        union all

        select
          tc.id as id,
          'tunnels'::text as kind,
          tc.tunnel_id as entity_id,
          t.name as entity_title,
          tc.user_id,
          tc.user_email,
          tc.body,
          tc.created_at,
          tc.edited
        from tunnel_comments tc
        join tunnels t on t.id = tc.tunnel_id
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

/**
 * POST /api/updates/read-all
 * Oznacza wszystkie aktualnie "nieprzeczytane" wpisy jako przeczytane (dla zalogowanego usera)
 */
app.post("/api/updates/read-all", authRequired, async (req, res) => {
  try {
    const userId = req.user.id;

    // Limit bezpieczeństwa (żeby nie ładować tysięcy naraz)
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

        union all

        select
          tc.id as comment_id,
          'tunnels'::text as kind,
          tc.tunnel_id as entity_id
        from tunnel_comments tc
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
 * POST /api/updates/read
 * body: { kind: 'points'|'tunnels', entity_id: number, comment_id: number }
 * zapisuje, że user przeczytał wpis
 */
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
/**
 * POST /api/updates/read
 * body: { kind: "points"|"tunnels", entity_id: number, comment_id: number }
 * Zapisuje "przeczytane" w DB (idempotentne: ON CONFLICT)
 */
app.post("/api/updates/read", authRequired, async (req, res) => {
  try {
    const kind = String(req.body?.kind || "").trim();
    const entityId = Number(req.body?.entity_id);
    const commentId = Number(req.body?.comment_id);
    const userId = Number(req.user.id);

    if (kind !== "points" && kind !== "tunnels") {
      return res.status(400).json({ error: "kind musi być 'points' albo 'tunnels'" });
    }
    if (!Number.isFinite(entityId) || entityId <= 0) {
      return res.status(400).json({ error: "entity_id musi być liczbą" });
    }
    if (!Number.isFinite(commentId) || commentId <= 0) {
      return res.status(400).json({ error: "comment_id musi być liczbą" });
    }

    const q = await pool.query(
      `
      insert into read_updates (user_id, kind, entity_id, comment_id, read_at)
      values ($1, $2, $3, $4, now())
      on conflict (user_id, kind, entity_id, comment_id)
      do update set read_at = now()
      returning id, read_at;
      `,
      [userId, kind, entityId, commentId]
    );

    res.json({ ok: true, ...q.rows[0] });
  } catch (e) {
    console.error("POST UPDATES READ ERROR:", e);
    res.status(500).json({ error: "DB error", details: String(e) });
  }
});

// ===== START =====
app.listen(PORT, () => {
  console.log(`Backend działa na porcie ${PORT}`);
  console.log("CORS_ORIGIN:", process.env.CORS_ORIGIN);
  console.log("DATABASE_URL set:", !!DATABASE_URL);
});