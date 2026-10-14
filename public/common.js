/* Gemeinsame Helfer fuer alle Seiten (Header, API, Formatierung, SVG-Charts) */

const NAV = [
  ["/", "Dashboard"],
  ["/trips", "Trips"],
  ["/charging", "Charging"],
  ["/statistics", "Statistics"],
  ["/activities", "Activities"],
  ["/collector", "Collector"],
];

function renderHeader(activePath) {
  const links = NAV.map(([href, label]) =>
    `<a href="${href}" class="nav-link${href === activePath ? " active" : ""}">${label}</a>`).join("");
  document.getElementById("header").outerHTML = `
    <header class="topbar">
      <div class="brand">Munotstadt <span>Car</span></div>
      <div class="nav-right">
        <div class="nav-links">${links}</div>
        <a href="/cdn-cgi/access/logout" class="logout-link">Logout</a>
      </div>
    </header>`;
}

async function api(path, opts = {}) {
  const init = { cache: "no-store", credentials: "same-origin", ...opts };
  if (opts.body !== undefined) {
    init.headers = { "content-type": "application/json", ...(opts.headers || {}) };
    init.body = JSON.stringify(opts.body);
  }
  const res = await fetch(path, init);
  if (res.status === 401) { location.href = "/login"; throw new Error("Nicht angemeldet"); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function fmt(n, digits = 0) {
  if (n === null || n === undefined || n === "" || isNaN(n)) return "–";
  return Number(n).toLocaleString("de-CH", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
function setStatus(el, text, cls = "") { el.textContent = text; el.className = "status-msg " + cls; }

/* ---------- Zeit (DB = UTC 'YYYY-MM-DD HH:MM:SS', Anzeige = Europe/Zurich) ---------- */

const ZFMT = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Zurich", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
});
function parseUtc(s) { return Date.parse(String(s).replace(" ", "T") + "Z"); }
function zurichParts(ms) { return ZFMT.format(new Date(ms)); } // "2026-10-13 05:45:00"
function fmtZurich(utc) {
  if (!utc) return "–";
  const z = zurichParts(parseUtc(utc)); // YYYY-MM-DD HH:MM:SS
  return `${z.slice(8, 10)}.${z.slice(5, 7)}.${z.slice(0, 4)} ${z.slice(11, 16)}`;
}
function utcToZurichInput(utc) { return zurichParts(parseUtc(utc)).replace(" ", "T").slice(0, 16); }
function zurichInputToUtc(local) { // 'YYYY-MM-DDTHH:MM' (Zuercher Zeit) -> 'YYYY-MM-DD HH:MM:SS' UTC
  const guess = Date.parse(local + ":00Z");
  const offsetAt = (ms) => Date.parse(zurichParts(ms).replace(" ", "T") + "Z") - Math.floor(ms / 1000) * 1000;
  let utc = guess - offsetAt(guess);
  utc = guess - offsetAt(utc);
  return new Date(utc).toISOString().slice(0, 19).replace("T", " ");
}
function nowUtcStr() { return new Date().toISOString().slice(0, 19).replace("T", " "); }

/* ---------- SVG-Charts ---------- */

function niceTicks(min, max, n = 4) {
  const out = [];
  for (let i = 0; i <= n; i++) out.push(min + ((max - min) * i) / n);
  return out;
}

/** Liniendiagramm. pts: [{t: ms, v: number}] */
function lineChart(el, pts, o = {}) {
  const color = o.color || "#1f6feb", dec = o.decimals ?? 0, unit = o.unit || "";
  pts = pts.filter((p) => p.v !== null && p.v !== undefined && isFinite(p.v));
  if (pts.length < 2) { el.innerHTML = '<div class="empty">Zu wenig Daten im gewählten Zeitraum</div>'; return; }
  const W = 640, H = 190, pl = 48, pr = 12, pt = 10, pb = 24;
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
  const vs = pts.map((p) => p.v);
  let min = Math.min(...vs), max = Math.max(...vs);
  if (min === max) { min -= 1; max += 1; }
  const pad = (max - min) * 0.08; min -= pad; max += pad;
  if (o.clamp) { min = Math.max(o.clamp[0], min); max = Math.min(o.clamp[1], max); }
  const x = (t) => pl + ((t - t0) / (t1 - t0 || 1)) * (W - pl - pr);
  const y = (v) => pt + (1 - (v - min) / (max - min)) * (H - pt - pb);

  const grid = niceTicks(min, max).map((v) =>
    `<line x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}" stroke="var(--grid)"/>` +
    `<text x="${pl - 6}" y="${y(v) + 4}" text-anchor="end" font-size="10" fill="#8a8a8a">${fmt(v, dec)}</text>`).join("");
  const dfmt = new Intl.DateTimeFormat("de-CH", { timeZone: "Europe/Zurich", day: "2-digit", month: "2-digit" });
  const xt = niceTicks(t0, t1, 4).map((t, i) =>
    `<text x="${x(t)}" y="${H - 6}" text-anchor="${i === 0 ? "start" : i === 4 ? "end" : "middle"}" font-size="10" fill="#8a8a8a">${dfmt.format(new Date(t))}</text>`).join("");
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
  const area = `${line}L${x(t1).toFixed(1)},${H - pb}L${x(t0).toFixed(1)},${H - pb}Z`;

  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}">
      ${grid}${xt}
      <path d="${area}" fill="${color}" opacity=".08"/>
      <path d="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
      <circle class="hv" r="4" fill="${color}" stroke="#fff" stroke-width="1.5" style="display:none"/>
    </svg><div class="tt"></div>`;
  const svg = el.querySelector("svg"), tt = el.querySelector(".tt"), hv = el.querySelector(".hv");
  const tfmt = new Intl.DateTimeFormat("de-CH", { timeZone: "Europe/Zurich", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  svg.addEventListener("mousemove", (e) => {
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    let best = pts[0], bd = Infinity;
    for (const p of pts) { const d = Math.abs(x(p.t) - px); if (d < bd) { bd = d; best = p; } }
    hv.setAttribute("cx", x(best.t)); hv.setAttribute("cy", y(best.v)); hv.style.display = "";
    tt.style.display = "block";
    tt.style.left = (x(best.t) / W) * r.width + "px";
    tt.style.top = (y(best.v) / H) * r.height + "px";
    tt.textContent = `${tfmt.format(new Date(best.t))} · ${fmt(best.v, dec)}${unit ? " " + unit : ""}`;
  });
  svg.addEventListener("mouseleave", () => { hv.style.display = "none"; tt.style.display = "none"; });
}

/** Gruppierte Balken. labels: [..], a/b: [numbers|null] */
function groupedBars(el, labels, a, b, colors = ["#E30613", "#b5b5b5"], dec = 0) {
  const W = 640, H = 220, pl = 48, pr = 8, pt = 10, pb = 26;
  const max = Math.max(1, ...a.filter(Number.isFinite), ...b.filter(Number.isFinite)) * 1.08;
  const y = (v) => pt + (1 - v / max) * (H - pt - pb);
  const gw = (W - pl - pr) / labels.length, bw = Math.min(18, gw * 0.36);
  const grid = niceTicks(0, max).map((v) =>
    `<line x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}" stroke="var(--grid)"/>` +
    `<text x="${pl - 6}" y="${y(v) + 4}" text-anchor="end" font-size="10" fill="#8a8a8a">${fmt(v, 0)}</text>`).join("");
  let bars = "";
  labels.forEach((l, i) => {
    const cx = pl + gw * i + gw / 2;
    [[a[i], colors[0], -bw - 1], [b[i], colors[1], 1]].forEach(([v, c, dx]) => {
      if (!Number.isFinite(v) || v <= 0) return;
      bars += `<rect x="${cx + dx}" y="${y(v)}" width="${bw}" height="${H - pb - y(v)}" fill="${c}" rx="2"><title>${l}: ${fmt(v, dec)} km</title></rect>`;
    });
    bars += `<text x="${cx}" y="${H - 8}" text-anchor="middle" font-size="10" fill="#8a8a8a">${l}</text>`;
  });
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}">${grid}${bars}</svg>`;
}

/**
 * Liniendiagramm mit zwei Achsen: links Serie A, rechts Serie B.
 * rows: [{t: ms, a: number|null, b: number|null}]
 * oa/ob: {color, label, unit, decimals, clamp:[min,max]}
 */
function dualLineChart(el, rows, oa, ob) {
  const W = 640, H = 230, pl = 46, pr = 46, pt = 10, pb = 24;
  const A = rows.filter((r) => r.a !== null && r.a !== undefined && isFinite(r.a));
  const B = rows.filter((r) => r.b !== null && r.b !== undefined && isFinite(r.b));
  if (A.length < 2 && B.length < 2) { el.innerHTML = '<div class="empty">Zu wenig Daten im gewählten Zeitraum</div>'; return; }
  const ts = rows.map((r) => r.t);
  const t0 = Math.min(...ts), t1 = Math.max(...ts);
  const scale = (vals, clamp) => {
    if (!vals.length) return [0, 1];
    let min = Math.min(...vals), max = Math.max(...vals);
    if (min === max) { min -= 1; max += 1; }
    const pad = (max - min) * 0.08; min -= pad; max += pad;
    if (clamp) { min = Math.max(clamp[0], min); max = Math.min(clamp[1], max); }
    return [min, max];
  };
  const [amin, amax] = scale(A.map((r) => r.a), oa.clamp);
  const [bmin, bmax] = scale(B.map((r) => r.b), ob.clamp);
  const x = (t) => pl + ((t - t0) / (t1 - t0 || 1)) * (W - pl - pr);
  const ya = (v) => pt + (1 - (v - amin) / (amax - amin)) * (H - pt - pb);
  const yb = (v) => pt + (1 - (v - bmin) / (bmax - bmin)) * (H - pt - pb);

  const N = 4;
  let grid = "";
  for (let i = 0; i <= N; i++) {
    const va = amin + ((amax - amin) * i) / N, vb = bmin + ((bmax - bmin) * i) / N, yy = ya(va);
    grid += `<line x1="${pl}" x2="${W - pr}" y1="${yy}" y2="${yy}" stroke="var(--grid)"/>` +
      `<text x="${pl - 6}" y="${yy + 4}" text-anchor="end" font-size="10" fill="${oa.color}">${fmt(va, oa.decimals ?? 0)}</text>` +
      `<text x="${W - pr + 6}" y="${yy + 4}" text-anchor="start" font-size="10" fill="${ob.color}">${fmt(vb, ob.decimals ?? 0)}</text>`;
  }
  const dfmt = new Intl.DateTimeFormat("de-CH", { timeZone: "Europe/Zurich", day: "2-digit", month: "2-digit" });
  const xt = niceTicks(t0, t1, 4).map((t, i) =>
    `<text x="${x(t)}" y="${H - 6}" text-anchor="${i === 0 ? "start" : i === 4 ? "end" : "middle"}" font-size="10" fill="#8a8a8a">${dfmt.format(new Date(t))}</text>`).join("");
  const path = (arr, key, yf) => arr.map((r, i) => `${i ? "L" : "M"}${x(r.t).toFixed(1)},${yf(r[key]).toFixed(1)}`).join("");

  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}">
      ${grid}${xt}
      ${A.length > 1 ? `<path d="${path(A, "a", ya)}" fill="none" stroke="${oa.color}" stroke-width="2" stroke-linejoin="round"/>` : ""}
      ${B.length > 1 ? `<path d="${path(B, "b", yb)}" fill="none" stroke="${ob.color}" stroke-width="2" stroke-linejoin="round"/>` : ""}
      ${B.length === 1 ? `<circle cx="${x(B[0].t)}" cy="${yb(B[0].b)}" r="3" fill="${ob.color}"/>` : ""}
      <line class="vl" y1="${pt}" y2="${H - pb}" stroke="#999" stroke-dasharray="3 3" style="display:none"/>
    </svg><div class="tt"></div>`;
  const svg = el.querySelector("svg"), tt = el.querySelector(".tt"), vl = el.querySelector(".vl");
  const tfmt = new Intl.DateTimeFormat("de-CH", { timeZone: "Europe/Zurich", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  svg.addEventListener("mousemove", (e) => {
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    let best = rows[0], bd = Infinity;
    for (const p of rows) { const d = Math.abs(x(p.t) - px); if (d < bd) { bd = d; best = p; } }
    vl.setAttribute("x1", x(best.t)); vl.setAttribute("x2", x(best.t)); vl.style.display = "";
    tt.style.display = "block";
    tt.style.left = (x(best.t) / W) * r.width + "px";
    tt.style.top = "20px";
    tt.textContent = `${tfmt.format(new Date(best.t))} · ${oa.label} ${fmt(best.a, oa.decimals ?? 0)} ${oa.unit} · ${ob.label} ${fmt(best.b, ob.decimals ?? 0)} ${ob.unit}`;
  });
  svg.addEventListener("mouseleave", () => { vl.style.display = "none"; tt.style.display = "none"; });
}

/**
 * Streudiagramm mit optionaler Regressionsgeraden (y = a + b*x, kleinste Quadrate).
 * groups: [{color, label, pts:[{x, y, tip}]}]; o: {xLabel, yLabel, xMin, xMax, yMin, yMax, regression:bool}
 * Gibt {n, a, b, r2} der Regression zurueck (oder null).
 */
function scatterChart(el, groups, o = {}) {
  const all = groups.flatMap((g) => g.pts.map((p) => ({ ...p, color: g.color })));
  if (all.length < 2) { el.innerHTML = '<div class="empty">Zu wenig Daten für die gewählte Auswahl</div>'; return null; }
  const W = 640, H = 300, pl = 46, pr = 14, pt = 10, pb = 36;
  const xs = all.map((p) => p.x);
  const xmin = o.xMin ?? 0, xmax = o.xMax ?? Math.ceil(Math.max(...xs) / 50) * 50;
  const ymin = o.yMin ?? 0, ymax = o.yMax ?? 100;
  const x = (v) => pl + ((v - xmin) / (xmax - xmin || 1)) * (W - pl - pr);
  const y = (v) => pt + (1 - (v - ymin) / (ymax - ymin || 1)) * (H - pt - pb);

  const gy = niceTicks(ymin, ymax, 5).map((v) =>
    `<line x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}" stroke="var(--grid)"/>` +
    `<text x="${pl - 6}" y="${y(v) + 4}" text-anchor="end" font-size="10" fill="#8a8a8a">${fmt(v, 0)}</text>`).join("");
  const gx = niceTicks(xmin, xmax, 5).map((v) =>
    `<line x1="${x(v)}" x2="${x(v)}" y1="${pt}" y2="${H - pb}" stroke="var(--grid)"/>` +
    `<text x="${x(v)}" y="${H - pb + 14}" text-anchor="middle" font-size="10" fill="#8a8a8a">${fmt(v, 0)}</text>`).join("");
  const labels = `<text x="${(pl + W - pr) / 2}" y="${H - 4}" text-anchor="middle" font-size="10" fill="#666">${o.xLabel || ""}</text>` +
    `<text x="11" y="${(pt + H - pb) / 2}" text-anchor="middle" font-size="10" fill="#666" transform="rotate(-90 11 ${(pt + H - pb) / 2})">${o.yLabel || ""}</text>`;
  const dots = all.map((p) => `<circle cx="${x(p.x).toFixed(1)}" cy="${y(p.y).toFixed(1)}" r="3.2" fill="${p.color}" fill-opacity=".55" stroke="${p.color}" stroke-width=".6"/>`).join("");

  let reg = null, line = "";
  if (o.regression !== false && all.length >= 3) {
    const n = all.length, mx = xs.reduce((s, v) => s + v, 0) / n, my = all.reduce((s, p) => s + p.y, 0) / n;
    let sxx = 0, sxy = 0, syy = 0;
    for (const p of all) { sxx += (p.x - mx) ** 2; sxy += (p.x - mx) * (p.y - my); syy += (p.y - my) ** 2; }
    if (sxx > 0) {
      const b = sxy / sxx, a = my - b * mx;
      reg = { n, a, b, r2: syy > 0 ? (sxy * sxy) / (sxx * syy) : null };
      // Gerade auf den sichtbaren Bereich (y in [ymin,ymax]) zuschneiden
      let xa = Math.max(xmin, Math.min(...xs)), xb = Math.min(xmax, Math.max(...xs));
      line = `<line x1="${x(xa)}" y1="${y(a + b * xa)}" x2="${x(xb)}" y2="${y(a + b * xb)}" stroke="#E30613" stroke-width="2" stroke-dasharray="6 4"/>`;
    }
  }
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}">${gy}${gx}${labels}${dots}${line}
      <circle class="hv" r="5" fill="none" stroke="#1a1a1a" stroke-width="1.5" style="display:none"/></svg><div class="tt"></div>`;
  const svg = el.querySelector("svg"), tt = el.querySelector(".tt"), hv = el.querySelector(".hv");
  svg.addEventListener("mousemove", (e) => {
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W, py = ((e.clientY - r.top) / r.height) * H;
    let best = null, bd = Infinity;
    for (const p of all) { const d = (x(p.x) - px) ** 2 + (y(p.y) - py) ** 2; if (d < bd) { bd = d; best = p; } }
    if (!best || bd > 30 * 30) { hv.style.display = "none"; tt.style.display = "none"; return; }
    hv.setAttribute("cx", x(best.x)); hv.setAttribute("cy", y(best.y)); hv.style.display = "";
    tt.style.display = "block";
    tt.style.left = (x(best.x) / W) * r.width + "px";
    tt.style.top = (y(best.y) / H) * r.height + "px";
    tt.textContent = best.tip || `${fmt(best.x)} km · ${fmt(best.y)} %`;
  });
  svg.addEventListener("mouseleave", () => { hv.style.display = "none"; tt.style.display = "none"; });
  return reg;
}
