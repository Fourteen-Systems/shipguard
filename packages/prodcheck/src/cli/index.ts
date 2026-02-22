import { Command } from "commander";
import { cmdScan } from "./commands/scan.js";
import { cmdCi } from "./commands/ci.js";
import { cmdInit } from "./commands/init.js";
import { cmdBaseline } from "./commands/baseline.js";
import { cmdWaive } from "./commands/waive.js";
import { cmdRules } from "./commands/rules.js";
import { cmdExplain } from "./commands/explain.js";

const program = new Command();

program
  .name("prodcheck")
  .description("Code-level operational maturity analysis for Next.js projects")
  .version("0.1.0");

program
  .command("init")
  .description("Detect framework, generate config, and run first scan")
  .option("--force", "Overwrite existing config")
  .option("--dry-run", "Print what would happen without writing files")
  .action(cmdInit);

program
  .command("scan", { isDefault: true })
  .description("Scan the project and print readiness report")
  .option("--format <format>", "Output format: pretty, json, sarif", "pretty")
  .option("--output <path>", "Write report to file")
  .option("--only <rules>", "Run only specified rules (comma-separated)")
  .option("--exclude <globs>", "Additional exclude patterns (comma-separated)")
  .option("--min-confidence <level>", "Minimum confidence to report: low, med, high")
  .action(cmdScan);

program
  .command("ci")
  .description("CI mode: enforce thresholds and fail on regressions")
  .option("--preview", "Free preview mode: run scan without enforcement (no Pro key required)")
  .option("--fail-on <severity>", "Minimum severity to fail: low, med, high, critical", "critical")
  .option("--min-confidence <level>", "Minimum confidence to fail: low, med, high", "high")
  .option("--min-score <score>", "Minimum passing score", "70")
  .option("--baseline <path>", "Baseline file for regression detection")
  .option("--max-new-critical <n>", "Max new critical findings allowed", "0")
  .option("--max-new-high <n>", "Max new high findings allowed")
  .option("--format <format>", "Output format: pretty, json, sarif", "pretty")
  .option("--output <path>", "Write report to file")
  .action(cmdCi);

program
  .command("baseline")
  .description("Write or update baseline snapshot")
  .option("--write", "Write baseline file")
  .option("--output <path>", "Baseline output path")
  .action(cmdBaseline);

program
  .command("waive <rule>")
  .description("Add a waiver for a specific finding")
  .requiredOption("--file <path>", "File to waive")
  .requiredOption("--reason <reason>", "Reason for waiver")
  .option("--expiry <date>", "Waiver expiry date (ISO format)")
  .action(cmdWaive);

program
  .command("rules")
  .description("List all available rules")
  .action(cmdRules);

program
  .command("explain <rule>")
  .description("Show detailed explanation for a rule")
  .action(cmdExplain);

program.parse();
