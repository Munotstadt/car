// Erzeugt ein neues TOTP-Secret fuer Google Authenticator.
//   node scripts/gen-totp.mjs
// Danach:
//   1. Secret in Google Authenticator eintragen (Schluessel manuell eingeben, "Zeitbasiert")
//   2. npx wrangler secret put TOTP_SECRET     (Secret einfuegen)
//   3. npx wrangler secret put SESSION_SECRET  (z.B. Ausgabe von: openssl rand -hex 32)
import { randomBytes } from "node:crypto";

const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const bytes = randomBytes(20);
let bits = 0, val = 0, out = "";
for (const b of bytes) {
  val = (val << 8) | b; bits += 8;
  while (bits >= 5) { out += A[(val >>> (bits - 5)) & 31]; bits -= 5; }
  val &= (1 << bits) - 1;
}
if (bits > 0) out += A[(val << (5 - bits)) & 31];

console.log("TOTP_SECRET :", out);
console.log("otpauth-URI :", `otpauth://totp/car.munot.app:Philipp?secret=${out}&issuer=car.munot.app&digits=6&period=30`);
