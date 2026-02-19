import type { Finding, ScanResult, ShipguardConfig } from "../types.js";

export type ExtensionId = string;

export type GateResult =
  | { ok: true }
  | { ok: false; exitCode: number; message: string; details?: unknown };

export interface RunContext {
  rootDir: string;
  mode: "scan" | "ci" | "init";
}

export interface ExtensionHooks {
  /** Called after config is loaded. Can validate config or gate. */
  onConfigLoaded?: (args: {
    config: ShipguardConfig;
    ctx: RunContext;
  }) => GateResult | void;

  /** Called after analysis, before scoring. Can mutate findings or gate. */
  onFindings?: (args: {
    config: ShipguardConfig;
    ctx: RunContext;
    findings: Finding[];
  }) => GateResult | void;

  /** Called after scoring. Useful for policy gates. */
  onScored?: (args: {
    config: ShipguardConfig;
    ctx: RunContext;
    score: number;
    findings: Finding[];
  }) => GateResult | void;

  /** Called before writing outputs. Can attach extra report sections. */
  onReport?: (args: {
    config: ShipguardConfig;
    ctx: RunContext;
    result: ScanResult;
  }) => GateResult | void;

  /** Called during `shipguard init`. Can add setup messages. */
  onInit?: (args: {
    config: ShipguardConfig;
    ctx: RunContext;
    messages: string[];
  }) => void;
}

export interface ShipguardExtension {
  id: ExtensionId;
  hooks: ExtensionHooks;
}
