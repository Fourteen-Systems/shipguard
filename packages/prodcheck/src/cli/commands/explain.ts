import pc from "picocolors";
import { RULE_REGISTRY } from "../../rules/index.js";

export async function cmdExplain(ruleId: string): Promise<void> {
  const rule = RULE_REGISTRY.find(
    (r) => r.id === ruleId || r.id === ruleId.toUpperCase(),
  );

  if (!rule) {
    console.error(pc.red(`  Unknown rule: ${ruleId}`));
    console.error(pc.dim(`  Run \`prodcheck rules\` to see available rules.`));
    process.exit(1);
  }

  console.log(`\n  ${pc.bold(rule.id)}`);
  console.log(`  ${rule.name}`);
  console.log(`  Default severity: ${rule.defaultSeverity}`);
  console.log("");
  console.log(`  ${rule.description}`);
  console.log("");
  console.log(`  ${pc.dim("How it works:")}`);
  console.log(`  ${rule.docs}`);
  console.log("");
}
