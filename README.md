# car.munot.app

Dashboard für die Škoda-Enyaq-Daten (Cloudflare Worker + D1 `car`), Layout analog `energymanager`.

| Seite | Pfad | Inhalt |
|---|---|---|
| Dashboard | `/` | Kacheln km-Stand, SoC, Reichweite je mit Chart (7/30/90 Tage/Alles) |
| Trips | `/trips` | Tabelle `skoda_trips_tbl`, Zeilen editierbar |
| Statistics | `/statistics` | km YtD vs. PYtD, Tabelle Monat / km Monat |
| Activities | `/activities` | Tabelle `skoda_activites_tbl` (anlegen, ändern, löschen) |

## Aufbau

- `src/index.js` – Worker: Login (Google Authenticator / TOTP), JSON-API, Auslieferung von `public/`
- `public/` – statische Seiten (HTML/CSS/JS, kein Build-Schritt)
- `schema/d1_schema.sql` – Ergänzungen zur D1-DB (`skoda_activites_tbl`, Login-Tabellen); der Worker legt sie bei Bedarf selbst an
- `wrangler.jsonc` – Worker-Konfiguration (Custom Domain `car.munot.app`, D1-Binding `DB` → `car`)

## Login (Google Authenticator)

Alle Seiten und `/api/*` sind nur mit Session-Cookie erreichbar; Login unter `/login` mit dem 6-stelligen TOTP-Code.
Schutz: 5 Fehlversuche pro IP / 20 global je 15 Min., jeder Code nur einmal verwendbar, Session 30 Tage (HttpOnly, Secure, SameSite=Strict).

Einmalige Einrichtung:

```bash
node scripts/gen-totp.mjs                 # gibt TOTP_SECRET + otpauth-URI aus
npx wrangler secret put TOTP_SECRET       # Secret einfügen
npx wrangler secret put SESSION_SECRET    # z.B. Ausgabe von: openssl rand -hex 32
```

Das Secret in Google Authenticator per «Setup-Schlüssel eingeben» (zeitbasiert) erfassen oder die otpauth-URI als QR-Code darstellen.
Secrets können alternativ im Cloudflare-Dashboard (Worker → Settings → Variables and Secrets) gesetzt werden.

## Deployment

Cloudflare Workers Builds, verbunden mit diesem Repo (Root `/`, Deploy-Befehl `npx wrangler deploy`).
Jeder Push auf `main` deployt automatisch. `munot.app` muss als Zone im selben Cloudflare-Account liegen.

## Hinweise

- Zeiten in der DB sind UTC (`YYYY-MM-DD HH:MM:SS`), Anzeige in Europe/Zurich.
- Statistik-km = Summe `distance_km` aus `skoda_trips_tbl` nach Startdatum (UTC); YtD/PYtD jeweils bis zum heutigen Kalendertag.
- Beim Anlegen einer Activity werden leere Odometer/SoC/Range-Felder mit dem letzten Collector-Stand vorbelegt.
