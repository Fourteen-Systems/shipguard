import { build } from "esbuild";

await build({
  entryPoints: ["dist/index.js"],
  bundle: true,
  platform: "node",
  target: "node20",
  outfile: "dist/index.js",
  format: "esm",
  allowOverwrite: true,
  banner: {
    js: "import { createRequire } from 'module'; import { fileURLToPath as __esm_fileURLToPath } from 'url'; import { dirname as __esm_dirname } from 'path'; const require = createRequire(import.meta.url); const __filename = __esm_fileURLToPath(import.meta.url); const __dirname = __esm_dirname(__filename);",
  },
});
