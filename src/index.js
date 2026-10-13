/**
 * car.munot.app
 *
 * Cloudflare Worker: JSON-API auf D1 "car" und Auslieferung der statischen Seiten
 * aus ./public (Assets-Binding). Der Zugriffsschutz (Google-Login) laeuft komplett
 * ueber Cloudflare Access vor car.munot.app -- unauthentifizierte Requests erreichen
 * den Worker gar nicht erst (workers.dev ist deaktiviert, siehe wrangler.jsonc).
 */

/* ---------------------------------------------------------------------- *
 * Helpers
 * ---------------------------------------------------------------------- */

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}
function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}
/* ---------------------------------------------------------------------- *
 * Schema (idempotent)
 * ---------------------------------------------------------------------- */

let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS skoda_activites_tbl (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      activity_time_utc TEXT NOT NULL, activity TEXT NOT NULL, activity_comment TEXT,
      odometer_km REAL, soc_percentage REAL, range_km REAL,
      placeholder1 TEXT, placeholder2 TEXT, placeholder3 TEXT, placeholder4 TEXT, placeholder5 TEXT,
      at_date_utc TEXT NOT NULL)`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_activities_time ON skoda_activites_tbl(activity_time_utc)"),
  ]);
  schemaReady = true;
}

/* ---------------------------------------------------------------------- *
 * API
 * ---------------------------------------------------------------------- */

function zurichToday() {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich", year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(new Date()).map((x) => [x.type, x.value])
  );
  return `${p.year}-${p.month}-${p.day}`;
}

function parseNum(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error("Ungültige Zahl: " + v);
  return n;
}
function parseText(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s.slice(0, 500);
}

const TRIP_FIELDS = {
  classification: parseText, start_address: parseText, end_address: parseText,
  distance_km: parseNum, consumption_kwh: parseNum,
  start_odometer_km: parseNum, end_odometer_km: parseNum,
  start_soc_percent: parseNum, end_soc_percent: parseNum,
  temperature_c: parseNum, weather: parseText, tires: parseText,
};
const ACT_FIELDS = {
  activity: parseText, activity_comment: parseText,
  odometer_km: parseNum, soc_percentage: parseNum, range_km: parseNum,
  placeholder1: parseText, placeholder2: parseText, placeholder3: parseText,
  placeholder4: parseText, placeholder5: parseText,
};
const UTC_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

function pick(body, spec) {
  const out = {};
  for (const [k, fn] of Object.entries(spec)) if (k in body) out[k] = fn(body[k]);
  return out;
}

async function handleApi(request, env, url) {
  const db = env.DB;
  const path = url.pathname;
  const method = request.method;

  if (method !== "GET" && !(request.headers.get("content-type") || "").includes("application/json")) {
    return json({ error: "Content-Type application/json erforderlich" }, 415);
  }

  try {
    // ---- Dashboard ----
    if (path === "/api/dashboard" && method === "GET") {
      const days = Math.max(0, Math.min(3650, parseInt(url.searchParams.get("days") || "30", 10) || 0));
      const latest = await db.prepare("SELECT * FROM skoda_collector_tbl ORDER BY collected_at_utc DESC LIMIT 1").first();
      const q = days > 0
        ? db.prepare(`SELECT collected_at_utc AS t, odometer_km, soc_percent, range_km FROM skoda_collector_tbl
                      WHERE collected_at_utc >= datetime('now', ?) ORDER BY collected_at_utc`).bind(`-${days} days`)
        : db.prepare(`SELECT collected_at_utc AS t, odometer_km, soc_percent, range_km FROM skoda_collector_tbl ORDER BY collected_at_utc`);
      const { results } = await q.all();
      return json({ latest, series: results || [] });
    }

    // ---- Trips ----
    if (path === "/api/trips" && method === "GET") {
      const { results } = await db.prepare("SELECT * FROM skoda_trips_tbl ORDER BY start_utc DESC").all();
      return json({ trips: results || [] });
    }
    let m = path.match(/^\/api\/trips\/(\d+)$/);
    if (m && method === "PATCH") {
      const id = Number(m[1]);
      const body = await request.json();
      const fields = pick(body, TRIP_FIELDS);
      const keys = Object.keys(fields);
      if (!keys.length) return json({ error: "Keine änderbaren Felder übergeben" }, 400);
      const res = await db.prepare(`UPDATE skoda_trips_tbl SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`)
        .bind(...keys.map((k) => fields[k]), id).run();
      if (!res.meta.changes) return json({ error: "Trip nicht gefunden" }, 404);
      if (keys.includes("distance_km") || keys.includes("consumption_kwh")) {
        await db.prepare(`UPDATE skoda_trips_tbl SET consumption_kwh_per_100km =
            CASE WHEN distance_km > 0 AND consumption_kwh IS NOT NULL THEN ROUND(consumption_kwh * 100.0 / distance_km, 1) ELSE NULL END
          WHERE id = ?`).bind(id).run();
      }
      const row = await db.prepare("SELECT * FROM skoda_trips_tbl WHERE id = ?").bind(id).first();
      return json({ trip: row });
    }

    // ---- Statistics ----
    if (path === "/api/stats" && method === "GET") {
      const today = zurichToday();
      const year = today.slice(0, 4);
      const prevYear = String(Number(year) - 1);
      const md = today.slice(5);
      const ytdQ = (y) => db.prepare(
        `SELECT COALESCE(SUM(distance_km), 0) km, COUNT(*) n FROM skoda_trips_tbl
         WHERE substr(start_utc, 1, 4) = ? AND substr(start_utc, 6, 5) <= ?`).bind(y, md).first();
      const [ytd, pytd, monthly] = await Promise.all([
        ytdQ(year), ytdQ(prevYear),
        db.prepare(`SELECT substr(start_utc, 1, 7) ym, ROUND(SUM(distance_km), 1) km, COUNT(*) n
                    FROM skoda_trips_tbl WHERE distance_km IS NOT NULL GROUP BY ym ORDER BY ym`).all(),
      ]);
      return json({ today, year, prevYear, ytd, pytd, monthly: monthly.results || [] });
    }

    // ---- Activities ----
    if (path === "/api/activities" && method === "GET") {
      const { results } = await db.prepare("SELECT * FROM skoda_activites_tbl ORDER BY activity_time_utc DESC, id DESC").all();
      return json({ activities: results || [] });
    }
    if (path === "/api/activities" && method === "POST") {
      const body = await request.json();
      const time = String(body.activity_time_utc || "");
      if (!UTC_RE.test(time)) return json({ error: "activity_time_utc im Format YYYY-MM-DD HH:MM:SS erforderlich" }, 400);
      const f = pick(body, ACT_FIELDS);
      if (!f.activity) return json({ error: "activity erforderlich" }, 400);
      // Fehlende Fahrzeugwerte mit dem letzten Collector-Stand (<= Zeitpunkt) vorbelegen
      const snap = await db.prepare(
        `SELECT odometer_km, soc_percent, range_km FROM skoda_collector_tbl
         WHERE collected_at_utc <= ? ORDER BY collected_at_utc DESC LIMIT 1`).bind(time).first()
        || await db.prepare("SELECT odometer_km, soc_percent, range_km FROM skoda_collector_tbl ORDER BY collected_at_utc DESC LIMIT 1").first();
      const odo = "odometer_km" in f ? f.odometer_km : snap?.odometer_km ?? null;
      const soc = "soc_percentage" in f ? f.soc_percentage : snap?.soc_percent ?? null;
      const rng = "range_km" in f ? f.range_km : snap?.range_km ?? null;
      const res = await db.prepare(
        `INSERT INTO skoda_activites_tbl (activity_time_utc, activity, activity_comment, odometer_km, soc_percentage, range_km,
           placeholder1, placeholder2, placeholder3, placeholder4, placeholder5, at_date_utc)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(time, f.activity, f.activity_comment ?? null, odo, soc, rng,
          f.placeholder1 ?? null, f.placeholder2 ?? null, f.placeholder3 ?? null, f.placeholder4 ?? null, f.placeholder5 ?? null,
          time.slice(0, 10)).run();
      const row = await db.prepare("SELECT * FROM skoda_activites_tbl WHERE id = ?").bind(res.meta.last_row_id).first();
      return json({ activity: row }, 201);
    }
    m = path.match(/^\/api\/activities\/(\d+)$/);
    if (m && method === "PATCH") {
      const id = Number(m[1]);
      const body = await request.json();
      const fields = pick(body, ACT_FIELDS);
      if ("activity_time_utc" in body) {
        const t = String(body.activity_time_utc);
        if (!UTC_RE.test(t)) return json({ error: "activity_time_utc ungültig" }, 400);
        fields.activity_time_utc = t;
        fields.at_date_utc = t.slice(0, 10);
      }
      if ("activity" in fields && !fields.activity) return json({ error: "activity darf nicht leer sein" }, 400);
      const keys = Object.keys(fields);
      if (!keys.length) return json({ error: "Keine änderbaren Felder übergeben" }, 400);
      const res = await db.prepare(`UPDATE skoda_activites_tbl SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`)
        .bind(...keys.map((k) => fields[k]), id).run();
      if (!res.meta.changes) return json({ error: "Activity nicht gefunden" }, 404);
      const row = await db.prepare("SELECT * FROM skoda_activites_tbl WHERE id = ?").bind(id).first();
      return json({ activity: row });
    }
    if (m && method === "DELETE") {
      const res = await db.prepare("DELETE FROM skoda_activites_tbl WHERE id = ?").bind(Number(m[1])).run();
      if (!res.meta.changes) return json({ error: "Activity nicht gefunden" }, 404);
      return json({ ok: true });
    }

    return json({ error: "Nicht gefunden" }, 404);
  } catch (e) {
    if (e instanceof SyntaxError || /Ungültige Zahl/.test(e.message)) return json({ error: e.message }, 400);
    console.log("API-Fehler:", e);
    return json({ error: "Interner Fehler" }, 500);
  }
}

/* ---------------------------------------------------------------------- *
 * Entry
 * ---------------------------------------------------------------------- */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    await ensureSchema(env.DB);
    if (url.pathname.startsWith("/api/")) return handleApi(request, env, url);
    return env.ASSETS.fetch(request);
  },
};
