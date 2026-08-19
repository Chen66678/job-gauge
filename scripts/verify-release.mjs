import { existsSync, readFileSync } from "node:fs";

const failures = [];
const fail = (message) => failures.push(message);

const requiredDocs = ["README.md", "SECURITY.md", "LICENSE"];
const requiredCodeFiles = [
  "index.html",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "vite.config.ts",
  "vitest.config.ts",
  "src/main.tsx",
  "src/App.tsx",
  "src/domain/coreApi.ts",
  "src/domain/coreState.ts",
  "src/domain/llmClient.ts",
  "electron/main.cjs",
  "electron/preload.cjs",
  "browser-extension/wxt.config.ts",
  "browser-extension/entrypoints/background.ts",
  "browser-extension/entrypoints/content.ts"
];

for (const file of requiredDocs) {
  if (!existsSync(file)) {
    fail(`missing ${file}`);
    continue;
  }
  if (readFileSync(file, "utf8").trim().length === 0) fail(`${file} is empty`);
}

for (const file of requiredCodeFiles) {
  if (!existsSync(file)) fail(`missing ${file}`);
}

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
for (const script of ["dev", "test", "build", "check", "verify:electron", "verify:browser-extension", "verify:release"]) {
  if (!pkg.scripts?.[script]) fail(`missing script ${script}`);
}

const packageJsonText = readFileSync("package.json", "utf8");
if (packageJsonText.includes("team084-boss-readonly-current-page-export")) {
  fail("package.json must not reference removed team084 artifact");
}
if (!packageJsonText.includes("verify-browser-extension-readonly-boundary.mjs")) {
  fail("verify:browser-extension must point at the current boundary script");
}
if (!packageJsonText.includes("verify-release.mjs")) {
  fail("verify:release must point at scripts/verify-release.mjs");
}

const indexHtml = readFileSync("index.html", "utf8");
if (!indexHtml.includes("Content-Security-Policy")) {
  fail("index.html must include a Content-Security-Policy meta tag");
}

if (failures.length > 0) {
  console.error("release verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("release verification passed");
