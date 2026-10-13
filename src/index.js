/**
 * car.munot.app
 *
 * Cloudflare Worker: Login per Google Authenticator (TOTP), JSON-API auf D1 "car"
 * und Auslieferung der statischen Seiten aus ./public (Assets-Binding).
 */

const COOKIE = "car_session";
const SESSION_DAYS = 30;
const MAX_FAILS_PER_IP = 5;
const MAX_FAILS_GLOBAL = 20;
const FAIL_WINDOW_S = 15 * 60;

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
const enc = new TextEncoder();

function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/* ---------------------------------------------------------------------- *
 * TOTP (RFC 6238, SHA-1, 6 Stellen, 30 s) -- kompatibel mit Google Authenticator
 * ---------------------------------------------------------------------- */

export function base32Decode(s) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  s = s.replace(/=+$/, "").replace(/\s+/g, "").toUpperCase();
  let bits = 0, val = 0;
  const out = [];
  for (const ch of s) {
    const i = A.indexOf(ch);
    if (i < 0) throw new Error("Ungueltiges Base32-Zeichen");
    val = (val << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((val >>> (bits - 8)) & 255);
      bits -= 8;
    }
    val &= (1 << bits) - 1;
  }
  return new Uint8Array(out);
}

export async function hotp(keyBytes, counter) {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const msg = new Uint8Array(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) { msg[i] = c & 255; c = Math.floor(c / 256); }
  const h = new Uint8Array(await crypto.subtle.sign("HMAC", key, msg));
  const o = h[19] & 15;
  const bin = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(bin % 1000000).padStart(6, "0");
}

/** Liefert den passenden Zeitschritt (Fenster +-1) oder null. */
export async function verifyTotp(secretB32, code, nowMs = Date.now()) {
  const keyBytes = base32Decode(secretB32);
  const step = Math.floor(nowMs / 30000);
  let match = null;
  for (const d of [-1, 0, 1]) {
    const expected = await hotp(keyBytes, step + d);
    if (safeEqual(expected, code) && match === null) match = step + d;
  }
  return match;
}

/* ---------------------------------------------------------------------- *
 * Session (signiertes Cookie)
 * ---------------------------------------------------------------------- */

async function hmacHex(secret, data) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}
async function makeSession(env) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  return `${exp}.${await hmacHex(env.SESSION_SECRET, "session:" + exp)}`;
}
async function isAuthed(request, env) {
  const m = (request.headers.get("cookie") || "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!m) return false;
  const [exp, sig] = m[1].split(".");
  if (!exp || !sig || !/^\d+$/.test(exp)) return false;
  if (Number(exp) < Date.now() / 1000) return false;
  return safeEqual(sig, await hmacHex(env.SESSION_SECRET, "session:" + exp));
}
function cookieHeader(value, maxAge) {
  return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
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
    db.prepare("CREATE TABLE IF NOT EXISTS auth_attempts (id INTEGER PRIMARY KEY AUTOINCREMENT, ip TEXT NOT NULL, ts INTEGER NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS auth_state (key TEXT PRIMARY KEY, value TEXT)"),
  ]);
  schemaReady = true;
}

/* ---------------------------------------------------------------------- *
 * Login
 * ---------------------------------------------------------------------- */

const LOGIN_HTML = `<!DOCTYPE html>
<html lang="de"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Munotstadt Car · Login</title>
<link rel="stylesheet" href="/style.css"></head>
<body>
<header class="topbar"><div class="brand">Munotstadt <span>Car</span></div></header>
<div class="login-wrap"><div class="login-card">
  <h1>Anmelden</h1>
  <p>6-stelliger Code aus Google Authenticator.</p>
  <input id="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="6" placeholder="123456" autofocus>
  <button id="btn" onclick="login()">Anmelden</button>
  <div id="msg" class="status-msg"></div>
</div></div>
<script>
const codeEl=document.getElementById('code'), msg=document.getElementById('msg');
codeEl.addEventListener('keydown',e=>{ if(e.key==='Enter') login(); });
codeEl.addEventListener('input',()=>{ if(codeEl.value.replace(/\\D/g,'').length===6) login(); });
let busy=false;
async function login(){
  const code=codeEl.value.replace(/\\D/g,'');
  if(busy||code.length!==6){ return; }
  busy=true; msg.className='status-msg pending'; msg.textContent='Prüfe…';
  try{
    const r=await fetch('/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code})});
    const j=await r.json().catch(()=>({}));
    if(r.ok){ location.href='/'; return; }
    msg.className='status-msg err'; msg.textContent=j.error||('Fehler '+r.status); codeEl.select();
  }catch(e){ msg.className='status-msg err'; msg.textContent='Netzwerkfehler'; }
  busy=false;
}
</script></body></html>`;

async function handleLogin(request, env) {
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const now = Math.floor(Date.now() / 1000);
  const since = now - FAIL_WINDOW_S;

  const perIp = await env.DB.prepare("SELECT COUNT(*) n FROM auth_attempts WHERE ip = ? AND ts > ?").bind(ip, since).first();
  const global = await env.DB.prepare("SELECT COUNT(*) n FROM auth_attempts WHERE ts > ?").bind(since).first();
  if (perIp.n >= MAX_FAILS_PER_IP || global.n >= MAX_FAILS_GLOBAL) {
    return json({ error: "Zu viele Fehlversuche. Bitte in 15 Minuten erneut versuchen." }, 429);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: "Ungültige Anfrage" }, 400); }
  const code = String(body?.code || "").replace(/\D/g, "");

  const step = code.length === 6 ? await verifyTotp(env.TOTP_SECRET, code) : null;
  let ok = false;
  if (step !== null) {
    // Replay-Schutz: jeder Zeitschritt darf nur einmal verwendet werden.
    const last = await env.DB.prepare("SELECT value FROM auth_state WHERE key = 'last_totp_step'").first();
    if (!last || step > Number(last.value)) {
      await env.DB.prepare("INSERT INTO auth_state (key, value) VALUES ('last_totp_step', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .bind(String(step)).run();
      ok = true;
    }
  }

  if (!ok) {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO auth_attempts (ip, ts) VALUES (?, ?)").bind(ip, now),
      env.DB.prepare("DELETE FROM auth_attempts WHERE ts < ?").bind(now - 86400),
    ]);
    return json({ error: "Code ungültig oder bereits verwendet" }, 401);
  }

  await env.DB.prepare("DELETE FROM auth_attempts WHERE ip = ?").bind(ip).run();
  return json({ ok: true }, 200, { "set-cookie": cookieHeader(await makeSession(env), SESSION_DAYS * 86400) });
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
    const path = url.pathname;

    if (!env.TOTP_SECRET || !env.SESSION_SECRET) {
      return html("<h1>Konfiguration unvollständig</h1><p>Secrets TOTP_SECRET und SESSION_SECRET sind nicht gesetzt.</p>", 503);
    }
    await ensureSchema(env.DB);

    if (path === "/login" && request.method === "GET") return html(LOGIN_HTML);
    if (path === "/style.css") return env.ASSETS.fetch(request); // Login-Seite braucht das Stylesheet
    if (path === "/api/login" && request.method === "POST") return handleLogin(request, env);
    if (path === "/logout") {
      return new Response(null, { status: 302, headers: { location: "/login", "set-cookie": cookieHeader("", 0) } });
    }

    if (!(await isAuthed(request, env))) {
      if (path.startsWith("/api/")) return json({ error: "Nicht angemeldet" }, 401);
      return new Response(null, { status: 302, headers: { location: "/login" } });
    }

    if (path.startsWith("/api/")) return handleApi(request, env, url);
    return env.ASSETS.fetch(request);
  },
};
