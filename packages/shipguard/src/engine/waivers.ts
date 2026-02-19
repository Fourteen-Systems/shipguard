import path from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { Finding, Waiver } from "./types.js";

export function loadWaivers(rootDir: string, waiversFile: string): Waiver[] {
  const abs = path.join(rootDir, waiversFile);
  if (!existsSync(abs)) return [];
  return JSON.parse(readFileSync(abs, "utf8")) as Waiver[];
}

export function saveWaivers(rootDir: string, waiversFile: string, waivers: Waiver[]): void {
  const abs = path.join(rootDir, waiversFile);
  writeFileSync(abs, JSON.stringify(waivers, null, 2) + "\n");
}

export function addWaiver(
  rootDir: string,
  waiversFile: string,
  waiver: Omit<Waiver, "createdAt">,
): Waiver {
  const waivers = loadWaivers(rootDir, waiversFile);
  const full: Waiver = {
    ...waiver,
    createdAt: new Date().toISOString(),
  };
  waivers.push(full);
  saveWaivers(rootDir, waiversFile, waivers);
  return full;
}

export function applyWaivers(
  findings: Finding[],
  waivers: Waiver[],
): { active: Finding[]; waived: Finding[] } {
  const active: Finding[] = [];
  const waived: Finding[] = [];

  for (const f of findings) {
    const hasWaiver = waivers.some(
      (w) =>
        w.ruleId === f.ruleId &&
        w.file === f.file &&
        !isExpired(w),
    );
    if (hasWaiver) {
      waived.push(f);
    } else {
      active.push(f);
    }
  }

  return { active, waived };
}

function isExpired(w: Waiver): boolean {
  if (!w.expiry) return false;
  return new Date(w.expiry) < new Date();
}
