import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const failures = [];
const fail = (message) => failures.push(message);

const requiredDocs = ["README.md", "SECURITY.md", "LICENSE", "CONTRIBUTING.md", "CODE_OF_CONDUCT.md", "CHANGELOG.md"];
const requiredReadmeAssets = [
  "docs/readme-assets/job-list.png",
  "docs/readme-assets/job-detail.png",
  "docs/readme-assets/fact-conflict.png",
  "docs/readme-assets/custom-resume.png"
];
const expectedReadmeAssetSize = { width: 1600, height: 1050 };
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

const readme = readFileSync("README.md", "utf8");
for (const file of requiredReadmeAssets) {
  if (!existsSync(file)) {
    fail(`missing ${file}`);
    continue;
  }
  if (!readme.includes(file)) fail(`README.md must reference ${file}`);

  const png = readFileSync(file);
  const isPng = png.length >= 24 && png.subarray(0, 8).toString("hex") === "89504e470d0a1a0a";
  if (!isPng) {
    fail(`${file} must be a valid PNG`);
    continue;
  }
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (width !== expectedReadmeAssetSize.width || height !== expectedReadmeAssetSize.height) {
    fail(`${file} must be ${expectedReadmeAssetSize.width}x${expectedReadmeAssetSize.height}, received ${width}x${height}`);
  }
}

for (const file of requiredCodeFiles) {
  if (!existsSync(file)) fail(`missing ${file}`);
}

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
for (const script of ["dev", "test", "build", "check", "verify:electron", "verify:browser-extension", "verify:release"]) {
  if (!pkg.scripts?.[script]) fail(`missing script ${script}`);
}
if (pkg.private !== false) fail("package.json must set private=false for the open-source repository");
if (pkg.name !== "job-gauge") fail("package.json name must be job-gauge");
if (pkg.productName !== "JobGauge") fail("package.json productName must be JobGauge");
if (pkg.license !== "MIT") fail("package.json must declare MIT license");
if (!pkg.engines?.node) fail("package.json must declare a supported Node engine");
if (pkg.repository?.url !== "git+https://github.com/Chen66678/job-gauge.git") {
  fail("package.json repository URL must point to Chen66678/job-gauge");
}

const extensionPkg = JSON.parse(readFileSync("browser-extension/package.json", "utf8"));
if (extensionPkg.name !== "job-gauge-browser-extension") {
  fail("browser-extension package name must identify JobGauge");
}
if (extensionPkg.scripts?.postinstall !== "npm run prepare" || extensionPkg.scripts?.prepare !== "wxt prepare") {
  fail("browser-extension must generate .wxt types via prepare/postinstall");
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
if (!indexHtml.includes("<title>JobGauge</title>")) fail("index.html title must be JobGauge");

const extensionConfig = readFileSync("browser-extension/wxt.config.ts", "utf8");
if (!extensionConfig.includes("name: 'JobGauge'")) fail("browser extension manifest name must be JobGauge");

if (existsSync(".git")) {
  const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" }).split(/\r?\n/).filter(Boolean);
  const forbiddenTrackedPrefixes = ["browser-extension/.output/", "browser-extension/.wxt/"];
  for (const file of tracked) {
    if (forbiddenTrackedPrefixes.some((prefix) => file.startsWith(prefix))) {
      fail(`generated artifact must not be tracked: ${file}`);
    }
  }
}

if (failures.length > 0) {
  console.error("release verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("release verification passed");
