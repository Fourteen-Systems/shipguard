import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { findServerActions, classifyMutationActions } from "./server-actions.js";
import type { NextServerAction } from "./types.js";

describe("findServerActions", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "shipguard-sa-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty when no files exist", async () => {
    mkdirSync(path.join(tmpDir, "app"));
    const actions = await findServerActions(tmpDir, []);
    expect(actions).toEqual([]);
  });

  it("ignores files without 'use server'", async () => {
    mkdirSync(path.join(tmpDir, "app", "lib"), { recursive: true });
    writeFileSync(path.join(tmpDir, "app", "lib", "utils.ts"), "export function foo() {}");
    const actions = await findServerActions(tmpDir, []);
    expect(actions).toEqual([]);
  });

  it("finds file-level 'use server' actions", async () => {
    mkdirSync(path.join(tmpDir, "app", "actions"), { recursive: true });
    writeFileSync(path.join(tmpDir, "app", "actions", "create.ts"), `"use server"
export async function createUser(data: FormData) {
  await prisma.user.create({ data: { name: data.get("name") } });
}
export async function deleteUser(id: string) {
  await prisma.user.delete({ where: { id } });
}`);
    const actions = await findServerActions(tmpDir, []);
    expect(actions.length).toBe(2);
    expect(actions.map((a) => a.exportName)).toContain("createUser");
    expect(actions.map((a) => a.exportName)).toContain("deleteUser");
  });

  it("finds file-level const exports", async () => {
    mkdirSync(path.join(tmpDir, "app", "actions"), { recursive: true });
    writeFileSync(path.join(tmpDir, "app", "actions", "submit.ts"), `"use server"
export const submitForm = async (data: FormData) => {
  await prisma.form.create({ data });
};`);
    const actions = await findServerActions(tmpDir, []);
    expect(actions.length).toBe(1);
    expect(actions[0].exportName).toBe("submitForm");
  });

  it("detects inline 'use server' in function body", async () => {
    mkdirSync(path.join(tmpDir, "app", "page"), { recursive: true });
    writeFileSync(path.join(tmpDir, "app", "page", "actions.tsx"), `
export async function createPost(data: FormData) {
  "use server";
  await prisma.post.create({ data });
}`);
    const actions = await findServerActions(tmpDir, []);
    expect(actions.length).toBe(1);
    expect(actions[0].exportName).toBe("createPost");
  });

  it("skips route handler files", async () => {
    mkdirSync(path.join(tmpDir, "app", "api", "test"), { recursive: true });
    writeFileSync(path.join(tmpDir, "app", "api", "test", "route.ts"), `"use server"
export async function POST() {}`);
    const actions = await findServerActions(tmpDir, []);
    expect(actions).toEqual([]);
  });

  it("respects exclude globs", async () => {
    mkdirSync(path.join(tmpDir, "app", "actions"), { recursive: true });
    writeFileSync(path.join(tmpDir, "app", "actions", "create.ts"), `"use server"
export async function createUser() {}`);
    const actions = await findServerActions(tmpDir, ["**/actions/**"]);
    expect(actions).toEqual([]);
  });

  it("detects mutation signals in server actions", async () => {
    mkdirSync(path.join(tmpDir, "app", "actions"), { recursive: true });
    writeFileSync(path.join(tmpDir, "app", "actions", "billing.ts"), `"use server"
export async function createCheckout() {
  await stripe.checkout.create({ mode: "payment" });
}`);
    const actions = await findServerActions(tmpDir, []);
    expect(actions.length).toBe(1);
    expect(actions[0].signals.hasStripeWriteEvidence).toBe(true);
  });

  it("returns <anonymous> when no named exports found", async () => {
    mkdirSync(path.join(tmpDir, "app", "actions"), { recursive: true });
    writeFileSync(path.join(tmpDir, "app", "actions", "misc.ts"), `"use server"
// file with use server but no exported functions
const internal = () => {};`);
    const actions = await findServerActions(tmpDir, []);
    expect(actions.length).toBe(1);
    expect(actions[0].exportName).toBe("<anonymous>");
  });

  it("uses custom appDir", async () => {
    mkdirSync(path.join(tmpDir, "src", "app", "actions"), { recursive: true });
    writeFileSync(path.join(tmpDir, "src", "app", "actions", "create.ts"), `"use server"
export async function createUser() {}`);
    const actions = await findServerActions(tmpDir, [], "src/app");
    expect(actions.length).toBe(1);
    expect(actions[0].file).toContain("src/app");
  });
});

describe("classifyMutationActions", () => {
  function makeAction(overrides: Partial<NextServerAction> = {}): NextServerAction {
    return {
      kind: "server-action",
      file: "app/actions/test.ts",
      exportName: "test",
      signals: {
        hasMutationEvidence: false,
        hasDbWriteEvidence: false,
        hasStripeWriteEvidence: false,
        mutationDetails: [],
      },
      ...overrides,
    };
  }

  it("filters to mutation actions only", () => {
    const actions = [
      makeAction({ exportName: "a", signals: { hasMutationEvidence: true, hasDbWriteEvidence: false, hasStripeWriteEvidence: false, mutationDetails: [] } }),
      makeAction({ exportName: "b" }),
      makeAction({ exportName: "c", signals: { hasMutationEvidence: false, hasDbWriteEvidence: true, hasStripeWriteEvidence: false, mutationDetails: [] } }),
    ];
    const mutations = classifyMutationActions(actions);
    expect(mutations).toHaveLength(2);
    expect(mutations.map((a) => a.exportName)).toEqual(["a", "c"]);
  });

  it("returns empty for no mutation actions", () => {
    const actions = [makeAction(), makeAction()];
    expect(classifyMutationActions(actions)).toHaveLength(0);
  });

  it("includes stripe write actions", () => {
    const actions = [
      makeAction({ exportName: "pay", signals: { hasMutationEvidence: false, hasDbWriteEvidence: false, hasStripeWriteEvidence: true, mutationDetails: [] } }),
    ];
    expect(classifyMutationActions(actions)).toHaveLength(1);
  });
});
