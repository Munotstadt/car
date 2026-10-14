# car.munot.app

Dashboard für die Škoda-Enyaq-Daten (Cloudflare Worker + D1 `car`), Layout analog `energymanager`.

| Seite | Pfad | Inhalt |
|---|---|---|
| Dashboard | `/` | Kacheln km-Stand, SoC, Reichweite je mit Chart (7/30/90 Tage/Alles) |
| Trips | `/trips` | Tabelle `skoda_trips_tbl`, Zeilen editierbar (Reifen: Sommer/Winter, Notiz) |
| Charging | `/charging` | Ladevorgänge erfassen und anpassen (Tabelle `car_charging_tbl`) |
| Statistics | `/statistics` | km YtD vs. PYtD, Tabelle Monat / km Monat, Streudiagramm Reichweite vs. SoC (Regression, Filter Reifen/Jahr) und Ø Reichweite bei 80 % SoC |
| Activities | `/activities` | Tabelle `skoda_activites_tbl` (anlegen, ändern, löschen) |
| Collector | `/collector` | Log der Tabelle `skoda_collector_tbl` (nur lesen, Filter Zeit/Source/fehlende Werte) |

## Aufbau

- `src/index.js` – Worker: JSON-API und Auslieferung von `public/`
- `public/` – statische Seiten (HTML/CSS/JS, kein Build-Schritt)
- `schema/d1_schema.sql` – Ergänzungen zur D1-DB (`skoda_activites_tbl`); der Worker legt sie bei Bedarf selbst an
- `wrangler.jsonc` – Worker-Konfiguration (Custom Domain `car.munot.app`, D1-Binding `DB` → `car`)

## Login (Google-SSO via Cloudflare Access)

Wie bei energymanager: Der Schutz liegt komplett vor dem Worker. `workers.dev` und Preview-URLs sind deaktiviert,
erreichbar ist nur `car.munot.app`. Der Worker selbst enthält keinen Login.

Einrichtung (Cloudflare Zero Trust → Access → Applications):

1. Bestehende Self-hosted-Application (die von energy.munot.app) um den Hostnamen `car.munot.app` ergänzen,
   oder eine neue Application `car.munot.app` mit derselben Policy (Google-Login, deine E-Mail) anlegen.
2. Logout-Link in der Navigation: `/cdn-cgi/access/logout`.

## Deployment

Cloudflare Workers Builds, verbunden mit diesem Repo (Root `/`, Deploy-Befehl `npx wrangler deploy`).
Jeder Push auf `main` deployt automatisch. `munot.app` muss als Zone im selben Cloudflare-Account liegen.

## Hinweise

- Zeiten in der DB sind UTC (`YYYY-MM-DD HH:MM:SS`), Anzeige in Europe/Zurich.
- Statistik-km stammen aus dem Odometer in `skoda_collector_tbl` (Monate in UTC): km Monat = höchster Stand des Monats minus höchster Stand der Vorperiode; YtD/PYtD jeweils bis zum heutigen Kalendertag. Der erste Monat mit Daten wird ab dem ersten Messwert gerechnet.
- Beim Anlegen einer Activity werden leere Odometer/SoC/Range-Felder mit dem letzten Collector-Stand vorbelegt.
