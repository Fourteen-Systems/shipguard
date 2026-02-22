import pc from "picocolors";
import { addWaiver } from "../../engine/waivers.js";
import { loadConfigIfExists, DEFAULT_CONFIG } from "../../engine/config.js";

interface WaiveOptions {
  file: string;
  reason: string;
  expiry?: string;
}

export async function cmdWaive(ruleId: string, opts: WaiveOptions): Promise<void> {
  try {
    // Validate expiry date if provided
    if (opts.expiry) {
      const d = new Date(opts.expiry);
      if (isNaN(d.getTime())) {
        console.error(pc.red(`  Invalid expiry date: "${opts.expiry}". Use ISO format (e.g., 2025-12-31)`));
        process.exit(1);
      }
    }

    const rootDir = process.cwd();
    const config = loadConfigIfExists(rootDir) ?? DEFAULT_CONFIG;

    const waiver = addWaiver(rootDir, config.waiversFile, {
      ruleId,
      file: opts.file,
      reason: opts.reason,
      expiry: opts.expiry,
    });

    console.log(pc.green(`  Waiver added for ${ruleId}`));
    console.log(pc.dim(`  File: ${waiver.file}`));
    console.log(pc.dim(`  Reason: ${waiver.reason}`));
    if (waiver.expiry) {
      console.log(pc.dim(`  Expires: ${waiver.expiry}`));
    }
  } catch (err) {
    console.error(pc.red(`  Error: ${err instanceof Error ? err.message : String(err)}`));
    process.exit(1);
  }
}
