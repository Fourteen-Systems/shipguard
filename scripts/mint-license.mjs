#!/usr/bin/env node

/**
 * Mint a Prodcheck Pro license key.
 *
 * Usage:
 *   node scripts/mint-license.mjs --sub "customer@example.com" --days 365
 *   node scripts/mint-license.mjs --sub "customer@example.com" --org "acme" --days 30
 *
 * Requires scripts/.license-private.pem (from generate-keypair.mjs).
 */

import { readFileSync } from "node:fs";
import { sign, createPrivateKey } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const __dirname = dirname(fileURLToPath(import.meta.url));

const { values } = parseArgs({
  options: {
    sub: { type: "string" },
    org: { type: "string" },
    days: { type: "string", default: "365" },
  },
});

if (!values.sub) {
  console.error("Usage: node scripts/mint-license.mjs --sub <email> [--org <org>] [--days <n>]");
  process.exit(1);
}

const privKeyPath = join(__dirname, ".license-private.pem");
let privateKeyPem;
try {
  privateKeyPem = readFileSync(privKeyPath, "utf8");
} catch {
  console.error(`Private key not found at ${privKeyPath}`);
  console.error("Run: node scripts/generate-keypair.mjs");
  process.exit(1);
}

const nowSec = Math.floor(Date.now() / 1000);
const days = parseInt(values.days, 10) || 365;

const payload = {
  sub: values.sub,
  ...(values.org ? { org: values.org } : {}),
  tier: "pro",
  iss: "fourteensystems.com",
  iat: nowSec,
  exp: nowSec + days * 86400,
};

const payloadBytes = Buffer.from(JSON.stringify(payload), "utf8");
const payloadB64 = payloadBytes.toString("base64url");

const privKey = createPrivateKey(privateKeyPem);
const signature = sign(null, payloadBytes, privKey);
const sigB64 = signature.toString("base64url");

const key = `pc_pro_${payloadB64}.${sigB64}`;

console.log("License key:");
console.log(key);
console.log("");
console.log("Payload:");
console.log(JSON.stringify(payload, null, 2));
console.log("");
console.log(`Expires: ${new Date(payload.exp * 1000).toISOString()}`);
