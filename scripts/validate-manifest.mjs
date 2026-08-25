import { access, readFile } from "node:fs/promises";

const manifest = JSON.parse(await readFile("dist/manifest.json", "utf8"));
if (manifest.manifest_version !== 3) throw new Error("Expected a Manifest V3 build.");
if (manifest.version !== "0.4.0") throw new Error(`Unexpected manifest version: ${manifest.version}`);
if (manifest.host_permissions.some((permission) => permission === "https://*/*" || permission === "<all_urls>")) {
  throw new Error("Broad production host permission is forbidden.");
}
await Promise.all([
  access(`dist/${manifest.background.service_worker}`),
  ...manifest.content_scripts.flatMap((entry) => entry.js.map((file) => access(`dist/${file}`))),
]);
console.log(`Manifest validation passed: ${manifest.name} v${manifest.version} (MV${manifest.manifest_version}).`);
