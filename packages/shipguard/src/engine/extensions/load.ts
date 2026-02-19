import { registerExtension } from "./registry.js";
import type { ShipguardConfig } from "../types.js";

/**
 * Attempts to load the governance module if a license key is present.
 * Soft-fails: OSS core runs fine without governance installed.
 *
 * NOTE: Not wired into run.ts yet. Will be integrated when governance
 * module is built. The extension types and registry are reserved now
 * so the boundary is defined.
 */
export async function loadGovernanceIfPresent(config: ShipguardConfig): Promise<void> {
  if (!config.license?.key) return;

  try {
    // @ts-expect-error — governance module is optional; not installed in OSS
    const mod: Record<string, unknown> = await import("@shipguard/governance");
    if (typeof mod.registerGovernance === "function") {
      (mod.registerGovernance as (api: { registerExtension: typeof registerExtension }) => void)({
        registerExtension,
      });
    }
  } catch {
    // Governance not installed — this is fine for OSS usage.
  }
}
