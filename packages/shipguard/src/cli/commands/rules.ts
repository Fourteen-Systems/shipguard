import pc from "picocolors";
import { RULE_REGISTRY } from "../../rules/index.js";

export async function cmdRules(): Promise<void> {
  console.log("\n  Shipguard Rules (v1)\n");

  for (const rule of RULE_REGISTRY) {
    const severityColor = rule.defaultSeverity === "critical" ? pc.red : pc.yellow;
    console.log(`  ${pc.bold(rule.id)} ${severityColor(`[${rule.defaultSeverity}]`)}`);
    console.log(`  ${pc.dim(rule.description)}`);
    console.log("");
  }

  console.log(pc.dim("  Run `shipguard explain <RULE>` for full details.\n"));
}
