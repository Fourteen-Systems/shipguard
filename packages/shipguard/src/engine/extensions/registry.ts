import type { ShipguardExtension } from "./types.js";

const extensions: ShipguardExtension[] = [];

export function registerExtension(ext: ShipguardExtension): void {
  extensions.push(ext);
}

export function getExtensions(): readonly ShipguardExtension[] {
  return extensions;
}

export function clearExtensions(): void {
  extensions.length = 0;
}
