/* Gemeinsame Helfer fuer alle Seiten (Header, API, Formatierung, SVG-Charts) */

const NAV = [
  ["/", "Dashboard"],
  ["/trips", "Trips"],
  ["/statistics", "Statistics"],
  ["/activities", "Activities"],
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
