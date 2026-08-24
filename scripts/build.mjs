import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";

const outdir = "dist";

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

await Promise.all([
  build({
    entryPoints: ["src/background/index.ts"],
    outfile: `${outdir}/background.js`,
    bundle: true,
    format: "esm",
    target: "chrome114",
    sourcemap: true,
  }),
  build({
    entryPoints: ["src/content/index.ts"],
    outfile: `${outdir}/content.js`,
    bundle: true,
    format: "iife",
    target: "chrome114",
    sourcemap: true,
  }),
  cp("manifest.json", `${outdir}/manifest.json`),
]);
