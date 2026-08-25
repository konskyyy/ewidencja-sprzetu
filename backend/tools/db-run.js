/**
 * Wykonuje plik SQL na bazie — w transakcji, domyślnie BEZ ZAPISU.
 *
 * Bez flagi --commit skrypt uruchamia SQL i robi ROLLBACK: widzisz
 * dokładnie, co by się stało, a baza zostaje nietknięta. Dopiero
 * --commit zatwierdza zmiany.
 *
 * Każdy błąd cofa całą transakcję — nie da się zostawić bazy
 * w połowie zmienionej.
 *
 * Użycie:
 *   cd backend
 *   node tools/db-run.js ../db/seed_magazyn.sql            # próba (rollback)
 *   node tools/db-run.js ../db/seed_magazyn.sql --commit   # zapis
 */
const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");

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
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
})();

const args = process.argv.slice(2);
const commit = args.includes("--commit");
const file = args.find((a) => !a.startsWith("--"));

if (!file) {
  console.error("Podaj plik SQL, np.: node tools/db-run.js ../db/seed_magazyn.sql");
  process.exit(1);
}
const sqlPath = path.resolve(process.cwd(), file);
if (!fs.existsSync(sqlPath)) {
  console.error("Nie znaleziono pliku:", sqlPath);
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("❌ Brak DATABASE_URL — utwórz backend/.env (wzór: backend/.env.example).");
  process.exit(1);
}

const sql = fs.readFileSync(sqlPath, "utf8");
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  console.log("Plik :", sqlPath);
  console.log("Tryb :", commit ? "ZAPIS (--commit)" : "PRÓBA — na końcu ROLLBACK, baza bez zmian");
  console.log("");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const result = await client.query(sql);
    const results = Array.isArray(result) ? result : [result];

    let affected = 0;
    for (const r of results) {
      if (!r) continue;
      if (typeof r.rowCount === "number" && r.command !== "SELECT") {
        affected += r.rowCount;
        console.log(`${r.command}: ${r.rowCount} wiersz(y)`);
      }
      if (r.command === "SELECT" && r.rows?.length) {
        console.log("\nWynik zapytania:");
        console.table(r.rows);
      }
    }
    console.log(`\nŁącznie zmienionych wierszy: ${affected}`);

    if (commit) {
      await client.query("COMMIT");
      console.log("\n✅ ZATWIERDZONO — zmiany są w bazie.");
    } else {
      await client.query("ROLLBACK");
      console.log("\n↩️  WYCOFANO — baza nietknięta.");
      console.log("   Aby zapisać na stałe, dodaj flagę --commit");
    }
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("\n❌ Błąd — całość wycofana:", e.message);
    if (e.position) console.error("   Pozycja w SQL:", e.position);
    process.exitCode = 1;
  } finally {
    client.release();
  }
}

main().finally(() => pool.end());
