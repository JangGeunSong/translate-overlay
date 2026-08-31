import { build } from "esbuild";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";

const outdir = "dist";
const demoEnabled = process.env.CONTEXT_READER_DEMO === "true";

async function buildManifest() {
  const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
  const configuredOrigin = process.env.CONTEXT_READER_API_ORIGIN;
  if (configuredOrigin) {
    const url = new URL(configuredOrigin);
    if (url.protocol !== "https:" || url.origin !== configuredOrigin.replace(/\/$/u, "")) {
      throw new Error("CONTEXT_READER_API_ORIGIN must be an exact HTTPS origin without a path.");
    }
    manifest.host_permissions = [...new Set([...manifest.host_permissions, `${url.origin}/*`])];
    const connectSource = url.origin;
    manifest.content_security_policy.extension_pages = manifest.content_security_policy.extension_pages.replace(
      /connect-src ([^;]+)/u,
      (_directive, sources) => `connect-src ${sources} ${connectSource}`,
    );
  }
  await writeFile(`${outdir}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

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
    define: {
      __CONTEXT_READER_DEMO_ENABLED__: JSON.stringify(demoEnabled),
    },
  }),
  buildManifest(),
]);
