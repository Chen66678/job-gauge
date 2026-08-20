import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const failures = [];
const fail = (message) => failures.push(message);

const requiredFiles = ["electron/main.cjs", "electron/preload.cjs", "package.json"];
for (const file of requiredFiles) {
  if (!existsSync(file)) fail(`missing ${file}`);
}

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const scripts = packageJson.scripts ?? {};
for (const script of ["electron:dev", "electron:start", "verify:electron"]) {
  if (!scripts[script]) fail(`missing script ${script}`);
}
if (packageJson.main !== "electron/main.cjs") fail("package main must point to electron/main.cjs");
if (!packageJson.devDependencies?.electron) fail("missing devDependency electron");

const mainSource = readFileSync("electron/main.cjs", "utf8");
const preloadSource = readFileSync("electron/preload.cjs", "utf8");

const requiredMainSnippets = [
  "contextIsolation: true",
  "nodeIntegration: false",
  "sandbox: true",
  'setWindowOpenHandler(() => ({ action: "deny" }))',
  'LOCAL_HOST_BIND_ADDRESS = "127.0.0.1"',
  "isAllowedHost(request.headers.host, port)",
  "isAllowedOrigin(origin)) return sendJson(response, 403",
  "isLoopbackAddress(request.socket.remoteAddress)",
  'request.headers["x-radar-token"] !== localApiToken',
  "2 * 1024 * 1024",
  'const PUBLIC_APP_NAME = "JobGauge"',
  'const LEGACY_RUNTIME_APP_NAME = "boss-local-job-radar"',
  'app.setName(LEGACY_RUNTIME_APP_NAME)',
  'app.setPath("userData", path.join(app.getPath("appData"), LEGACY_RUNTIME_APP_NAME))',
  'path.join(app.getPath("userData"), LEGACY_DATA_DIR_NAME, "core-state.json")',
  'path.join(app.getPath("userData"), LEGACY_DATA_DIR_NAME, "byok-key.enc.json")'
];
for (const snippet of requiredMainSnippets) {
  if (!mainSource.includes(snippet)) fail(`electron/main.cjs missing ${snippet}`);
}

// 本地 API 四道防线的顺序必须保持：Host → Origin → 回环 → token。
const localApiDefenseOrder = [
  mainSource.indexOf("isAllowedHost(request.headers.host, port)"),
  mainSource.indexOf("isAllowedOrigin(origin)) return sendJson(response, 403"),
  mainSource.indexOf("isLoopbackAddress(request.socket.remoteAddress)"),
  mainSource.indexOf('request.headers["x-radar-token"] !== localApiToken')
];
if (localApiDefenseOrder.some((index) => index < 0)) {
  fail("local API defense chain is incomplete");
} else if (localApiDefenseOrder.some((index, position) => position > 0 && index <= localApiDefenseOrder[position - 1])) {
  fail("local API defense order must be Host -> Origin -> loopback -> token");
}

if (mainSource.includes('targetUrl.startsWith("file://")') || mainSource.includes("targetUrl.startsWith('file://')")) {
  fail("electron/main.cjs must not allow arbitrary file:// navigation");
}

if (!preloadSource.includes("contextBridge.exposeInMainWorld")) fail("preload must use contextBridge");
if (!preloadSource.includes('ipcRenderer.invoke(`coreApi:${methodName}`')) fail("preload must invoke CoreApi through ipcRenderer.invoke");
if (preloadSource.includes('exposeInMainWorld("ipcRenderer"')) fail("preload must not expose ipcRenderer directly");
if (!preloadSource.includes('localHost: "available"')) fail("preload must expose only abstract local host capability");
if (!preloadSource.includes("exposesFilePath: false")) fail("preload must not expose raw job radar file paths");
if (!preloadSource.includes("exposesBlobContents: false")) fail("preload must not expose job radar blob contents");
if (preloadSource.includes("userData") && !preloadSource.includes("appData/userData")) fail("preload must expose only abstract storage metadata");
if (preloadSource.includes("job-radar")) fail("preload must not expose job radar relative file paths");

if (failures.length > 0) {
  console.error("electron scaffold verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("electron scaffold verification passed");
