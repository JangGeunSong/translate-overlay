import { access, readFile } from "node:fs/promises";

const manifest = JSON.parse(await readFile("dist/manifest.json", "utf8"));
if (manifest.manifest_version !== 3) throw new Error("Expected a Manifest V3 build.");
if (manifest.version !== "0.4.0") throw new Error(`Unexpected manifest version: ${manifest.version}`);
if (manifest.host_permissions.some((permission) => permission === "https://*/*" || permission === "<all_urls>")) {
  throw new Error("Broad production host permission is forbidden.");
}
const extensionCsp = manifest.content_security_policy?.extension_pages ?? "";
const connectSources = extensionCsp.match(/connect-src ([^;]+)/u)?.[1].trim().split(/\s+/u) ?? [];
if (!extensionCsp.includes("script-src 'self'") || !extensionCsp.includes("object-src 'self'") ||
    !extensionCsp.includes("connect-src http://localhost:* http://127.0.0.1:*") ||
    connectSources.includes("*") || connectSources.includes("https://*")) {
  throw new Error("Extension CSP must allow only self-hosted code and explicitly bounded remote connections.");
}
await Promise.all([
  access(`dist/${manifest.background.service_worker}`),
  ...manifest.content_scripts.flatMap((entry) => entry.js.map((file) => access(`dist/${file}`))),
]);
console.log(`Manifest validation passed: ${manifest.name} v${manifest.version} (MV${manifest.manifest_version}).`);
