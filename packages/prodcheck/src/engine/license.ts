import { verify, createPublicKey } from "node:crypto";

/**
 * Prodcheck Pro license verification.
 *
 * Key format: pc_pro_<base64url(payload)>.<base64url(signature)>
 * Payload:   JSON { sub, org?, tier, iss, iat, exp }
 * Signature: Ed25519 over the raw payload bytes
 *
 * Verification is fully offline — no network calls.
 */

// Ed25519 public key for verifying license signatures.
// The corresponding private key is held offline for key generation.
const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAfISU4mB83G7joDkEkwQ8MrgflJAhdLbg8yzxZhcDwbU=
-----END PUBLIC KEY-----`;

export interface LicensePayload {
  /** Customer identifier (email or user ID) */
  sub: string;
  /** Optional org/team scope */
  org?: string;
  /** License tier */
  tier: "pro";
  /** Issuer */
  iss: "fourteensystems.com";
  /** Issued at (unix seconds) */
  iat: number;
  /** Expiry (unix seconds) */
  exp: number;
}

export interface LicenseResult {
  valid: true;
  payload: LicensePayload;
}

export interface LicenseError {
  valid: false;
  reason: string;
}

export type LicenseCheck = LicenseResult | LicenseError;

const PREFIX = "pc_pro_";

/**
 * Resolve a license key from (in priority order):
 * 1. PRODCHECK_PRO_KEY env var
 * 2. config.license.key
 */
export function resolveLicenseKey(configKey?: string): string | undefined {
  return process.env.PRODCHECK_PRO_KEY || configKey || undefined;
}

/**
 * Validate and decode a Prodcheck Pro license key.
 * Fully offline — uses Ed25519 signature verification.
 */
export function validateLicense(key: string): LicenseCheck {
  if (!key.startsWith(PREFIX)) {
    return { valid: false, reason: "Invalid key format" };
  }

  const rest = key.slice(PREFIX.length);
  const dotIndex = rest.indexOf(".");
  if (dotIndex === -1) {
    return { valid: false, reason: "Invalid key format" };
  }

  const payloadB64 = rest.slice(0, dotIndex);
  const signatureB64 = rest.slice(dotIndex + 1);

  // Decode payload
  let payloadBytes: Buffer;
  let payload: LicensePayload;
  try {
    payloadBytes = Buffer.from(payloadB64, "base64url");
    payload = JSON.parse(payloadBytes.toString("utf8")) as LicensePayload;
  } catch {
    return { valid: false, reason: "Invalid key format" };
  }

  // Verify Ed25519 signature
  try {
    const sigBytes = Buffer.from(signatureB64, "base64url");
    const pubKey = createPublicKey(PUBLIC_KEY_PEM);
    const valid = verify(null, payloadBytes, pubKey, sigBytes);
    if (!valid) {
      return { valid: false, reason: "Invalid license signature" };
    }
  } catch {
    return { valid: false, reason: "Signature verification failed" };
  }

  // Check required fields
  if (payload.tier !== "pro" || payload.iss !== "fourteensystems.com") {
    return { valid: false, reason: "Invalid license payload" };
  }

  // Check expiry
  const nowSec = Math.floor(Date.now() / 1000);
  if (payload.exp && nowSec > payload.exp) {
    return { valid: false, reason: "License expired" };
  }

  return { valid: true, payload };
}

/**
 * Require a valid Pro license or exit with a helpful message.
 * Used at the top of Pro-gated commands.
 */
export function requireProLicense(configKey?: string): LicensePayload {
  const key = resolveLicenseKey(configKey);

  if (!key) {
    printUpgradeMessage("No Prodcheck Pro license key found.");
    process.exit(1);
  }

  const result = validateLicense(key);
  if (!result.valid) {
    printUpgradeMessage(result.reason);
    process.exit(1);
  }

  return result.payload;
}

function printUpgradeMessage(reason: string): void {
  console.error("");
  console.error(`  ${reason}`);
  console.error("");
  console.error("  This command requires Prodcheck Pro.");
  console.error("");
  console.error("  Set your key via:");
  console.error("    export PRODCHECK_PRO_KEY=pc_pro_...");
  console.error("  or in prodcheck.config.json:");
  console.error('    { "license": { "key": "pc_pro_..." } }');
  console.error("");
  console.error("  Get Pro → https://fourteensystems.com/prodcheck#pricing");
  console.error("");
}
