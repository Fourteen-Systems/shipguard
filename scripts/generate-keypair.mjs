#!/usr/bin/env node

/**
 * Generate an Ed25519 keypair for Prodcheck Pro license signing.
 *
 * Run once:  node scripts/generate-keypair.mjs
 *
 * Outputs:
 *   scripts/.license-private.pem  (KEEP SECRET — never commit)
 *   scripts/.license-public.pem   (embed in engine/license.ts)
 */

import { generateKeyPairSync } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

const privPath = join(__dirname, ".license-private.pem");
const pubPath = join(__dirname, ".license-public.pem");

writeFileSync(privPath, privateKey, { mode: 0o600 });
writeFileSync(pubPath, publicKey);

console.log("Keypair generated:");
console.log(`  Private: ${privPath}`);
console.log(`  Public:  ${pubPath}`);
console.log("");
console.log("Public key (paste into engine/license.ts):");
console.log(publicKey);
