/**
 * Diagnostyka bazy — TYLKO ODCZYT.
 * Nie modyfikuje żadnych danych; sprawdza, czy schemat i zawartość
 * odpowiadają temu, czego oczekuje aplikacja.
 *
 * Użycie:
 *   cd backend
 *   DATABASE_URL="postgres://..." node tools/db-check.js
 *
 * Connection string:
 *   Neon: console.neon.tech -> Project -> Connection Details -> Connection string
 */
const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");

// Wczytaj backend/.env, jeśli istnieje (bez dodatkowych zależności).
(function loadEnvFile() {
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith("#")) continue;
    const eq = s.indexOf("=");
    if (eq === -1) continue;
    const key = s.slice(0, eq).trim();
    let val = s.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
  console.log("Wczytano backend/.env");
})();

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("❌ Brak DATABASE_URL.");
  console.error("   Utwórz backend/.env (wzór w backend/.env.example)");
  console.error('   albo uruchom: DATABASE_URL="postgres://..." node tools/db-check.js');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Kolumny, których wymaga backend (index.js)
const REQUIRED = [
  "id", "name", "type", "status", "lat", "lng", "notes",
  "in_storage", "warehouse", "priority", "added_at",
  "last_calibration_at", "calibration_interval_years",
  "quantity", "unit",
];

async function main() {
  console.log("Łączę się z bazą…\n");

  const ver = await pool.query("SELECT version()");
  console.log("Serwer:", ver.rows[0].version.split(",")[0]);

  // --- tabele ---
  const tables = await pool.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' ORDER BY table_name
  `);
  const names = tables.rows.map((r) => r.table_name);
  console.log("\nTabele:", names.join(", ") || "(brak)");

  if (!names.includes("assets")) {
    console.log("\n❌ Brak tabeli `assets` — aplikacja nie ma gdzie trzymać sprzętu.");
    console.log("   To jest główny problem do naprawy.");
    return;
  }

  // --- kolumny assets ---
  const cols = await pool.query(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='assets'
    ORDER BY ordinal_position
  `);
  const have = cols.rows.map((c) => c.column_name);

  console.log("\nKolumny `assets` (" + have.length + "):");
  for (const c of cols.rows) {
    console.log(
      `  ${c.column_name.padEnd(30)} ${c.data_type.padEnd(26)} ${
        c.is_nullable === "NO" ? "NOT NULL" : ""
      }`
    );
  }

  const missing = REQUIRED.filter((c) => !have.includes(c));
  console.log(
    missing.length
      ? "\n❌ BRAKUJE kolumn wymaganych przez backend: " + missing.join(", ")
      : "\n✅ Wszystkie kolumny wymagane przez backend są obecne."
  );

  // --- kolumny NOT NULL, które mogą blokować zapis ---
  const blocking = cols.rows.filter(
    (c) =>
      c.is_nullable === "NO" &&
      !c.column_default &&
      !["id", "name"].includes(c.column_name)
  );
  if (blocking.length) {
    console.log(
      "\n⚠️  Kolumny NOT NULL bez wartości domyślnej (mogą blokować INSERT):"
    );
    for (const c of blocking) console.log("   -", c.column_name);
    console.log(
      "   Sprzęt magazynowy nie ma współrzędnych, więc lat/lng muszą\n" +
        "   dopuszczać NULL — inaczej dodanie do magazynu się nie powiedzie."
    );
  }

  // --- zawartość ---
  const counts = await pool.query(`
    SELECT
      COALESCE(type,'(null)') AS typ,
      count(*)::int AS ile,
      count(*) FILTER (WHERE COALESCE(in_storage,false))::int AS w_magazynie
    FROM assets GROUP BY type ORDER BY typ
  `);
  console.log("\nZawartość wg `type`:");
  if (!counts.rows.length) console.log("  (tabela jest pusta)");
  for (const r of counts.rows) {
    console.log(`  ${String(r.typ).padEnd(14)} ${String(r.ile).padStart(5)} szt.  (w magazynie: ${r.w_magazynie})`);
  }

  // --- rodzaje sprzętu (status) ---
  const byStatus = await pool.query(`
    SELECT COALESCE(status,'(null)') AS rodzaj, count(*)::int AS ile
    FROM assets WHERE COALESCE(type,'') <> 'material'
    GROUP BY status ORDER BY ile DESC
  `);
  if (byStatus.rows.length) {
    console.log("\nSprzęt wg rodzaju (kolumna `status`):");
    for (const r of byStatus.rows) {
      console.log(`  ${String(r.rodzaj).padEnd(20)} ${String(r.ile).padStart(5)}`);
    }
    const known = ["tachimetr", "pochylomierz", "czujnik_drgan", "inklinometr", "tensometr"];
    const unknown = byStatus.rows.filter((r) => !known.includes(r.rodzaj));
    if (unknown.length) {
      console.log(
        "\n⚠️  Rodzaje spoza listy w aplikacji (pokażą się jako „Inne”, bez koloru):"
      );
      for (const r of unknown) console.log(`   - ${r.rodzaj} (${r.ile} szt.)`);
    }
  }

  // --- użytkownicy ---
  if (names.includes("users")) {
    const u = await pool.query("SELECT count(*)::int AS ile FROM users");
    console.log("\nUżytkownicy:", u.rows[0].ile);
    if (u.rows[0].ile === 0) {
      console.log("  ⚠️  Brak kont — nie da się zalogować do aplikacji.");
    }
  }

  console.log("\nGotowe. Skrypt niczego nie zmienił.");
}

main()
  .catch((e) => {
    console.error("\n❌ Błąd:", e.message);
    if (/self signed|certificate/i.test(e.message)) {
      console.error("   Podpowiedź: Neon wymaga SSL — dopisz ?sslmode=require na końcu URL-a.");
    }
    if (/password|authentication/i.test(e.message)) {
      console.error("   Podpowiedź: błędne dane logowania w connection stringu.");
    }
    if (/timeout|ENOTFOUND|ECONNREFUSED/i.test(e.message)) {
      console.error("   Podpowiedź: baza nieosiągalna. W Neon sprawdź, czy projekt");
      console.error("   nie jest wstrzymany (suspended) i czy host w URL-u jest");
      console.error("   aktualny — zmienia się po odtworzeniu projektu lub brancha.");
    }
    process.exitCode = 1;
  })
  .finally(() => pool.end());
