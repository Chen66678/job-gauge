import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";

const requiredFiles = ["electron/main.cjs", "electron/preload.cjs", "package.json"];
const failures = [];

for (const file of requiredFiles) {
  if (!existsSync(file)) failures.push(`missing ${file}`);
}

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const scripts = packageJson.scripts ?? {};
for (const script of ["electron:dev", "electron:start", "verify:electron"]) {
  if (!scripts[script]) failures.push(`missing script ${script}`);
}
if (packageJson.main !== "electron/main.cjs") failures.push("package main must point to electron/main.cjs");
if (!packageJson.devDependencies?.electron) failures.push("missing devDependency electron");

const mainSource = readFileSync("electron/main.cjs", "utf8");
const preloadSource = readFileSync("electron/preload.cjs", "utf8");
const requiredMainSnippets = [
  "contextIsolation: true",
  "nodeIntegration: false",
  "sandbox: true",
  "pathToFileURL",
  "BUILT_RENDERER_ENTRY",
  "BUILT_RENDERER_ENTRY_URL",
  "BUILT_RENDERER_DIR_URL",
  "targetUrl === BUILT_RENDERER_ENTRY_URL",
  "targetUrl.startsWith(`${BUILT_RENDERER_DIR_URL}/`)",
  "loadURL(DEV_SERVER_URL)",
  "loadFile(BUILT_RENDERER_ENTRY)",
  "setWindowOpenHandler(() => ({ action: \"deny\" }))",
  "resolveJobRadarDataDir",
  "buildPackagedLocalHostOptions",
  "startPackagedLocalHost",
  "waitForServerListening",
  "closePackagedLocalHost",
  "isUrlWithinBase",
  "app.getPath(\"userData\")",
  "jobRadarDataDir",
  "path.join(userDataPath, JOB_RADAR_DATA_DIR_NAME)",
  "LOCAL_HOST_BIND_ADDRESS = \"127.0.0.1\"",
  "host: LOCAL_HOST_BIND_ADDRESS",
  "startLocalProviderProxyHost(options)",
  "await waitForServerListening(server)",
  "localHostState.server",
  "server.close(() =>",
  "loadURL(packagedRendererUrl)"
];
for (const snippet of requiredMainSnippets) {
  if (!mainSource.includes(snippet)) failures.push(`electron/main.cjs missing ${snippet}`);
}
if (mainSource.includes('targetUrl.startsWith("file://")') || mainSource.includes("targetUrl.startsWith('file://')")) {
  failures.push("electron/main.cjs must not allow arbitrary file:// navigation");
}
if (!preloadSource.includes("contextBridge.exposeInMainWorld")) failures.push("preload must use contextBridge");
if (preloadSource.includes("ipcRenderer")) failures.push("preload must not expose ipcRenderer in this scaffold gate");
if (!preloadSource.includes('localHost: "available"')) failures.push("preload must expose only abstract local host capability");
if (!preloadSource.includes("exposesFilePath: false")) failures.push("preload must not expose raw job radar file paths");
if (!preloadSource.includes("exposesBlobContents: false")) failures.push("preload must not expose job radar blob contents");
if (preloadSource.includes("userData") && !preloadSource.includes("appData/userData")) failures.push("preload must expose only abstract storage metadata");
if (preloadSource.includes("job-radar") || preloadSource.includes("repository.json")) failures.push("preload must not expose job radar relative file paths");

try {
  const helperStart = mainSource.indexOf("const JOB_RADAR_DATA_DIR_NAME");
  const helperEnd = mainSource.indexOf("function createMainWindow");
  const helperSource = helperStart >= 0 && helperEnd > helperStart ? mainSource.slice(helperStart, helperEnd) : "";
  const sandbox = { path, pathToFileURL: (value) => ({ href: `file://${value}` }), Error, Promise, Number, __dirname: "electron" };
  vm.runInNewContext(`${helperSource}\nthis.resolveJobRadarDataDir = resolveJobRadarDataDir;\nthis.buildPackagedLocalHostOptions = buildPackagedLocalHostOptions;\nthis.closePackagedLocalHost = closePackagedLocalHost;\nthis.isUrlWithinBase = isUrlWithinBase;`, sandbox);
  const windowsLike = sandbox.resolveJobRadarDataDir("C:\\Users\\dev\\AppData\\Roaming\\BossLocalJobRadar");
  const macLike = sandbox.resolveJobRadarDataDir("/Users/dev/Library/Application Support/BossLocalJobRadar");
  const options = sandbox.buildPackagedLocalHostOptions("C:\\Users\\dev\\AppData\\Roaming\\BossLocalJobRadar", { port: 4555 });
  if (!windowsLike.endsWith(`${path.sep}job-radar`) && !windowsLike.endsWith("\\job-radar")) failures.push("resolveJobRadarDataDir must append job-radar for Windows-like paths");
  if (!macLike.endsWith(`${path.sep}job-radar`)) failures.push("resolveJobRadarDataDir must append job-radar for mac-like paths");
  if (!options.jobRadarDataDir || !options.distDir || options.port !== 4555 || options.host !== "127.0.0.1") failures.push("buildPackagedLocalHostOptions must include distDir, jobRadarDataDir, loopback host, and passthrough options");
  const closeState = {
    server: {
      close(callback) {
        this.closeCalled = true;
        callback();
      },
      closeCalled: false
    },
    status: "available",
    url: "http://127.0.0.1:4555",
    port: 4555
  };
  const server = closeState.server;
  const closeResult = sandbox.closePackagedLocalHost(closeState);
  if (!server.closeCalled || closeState.status !== "stopped" || closeState.url !== null || closeState.port !== null) failures.push("closePackagedLocalHost must call server.close and clear local host state");
  if (!closeResult || typeof closeResult.then !== "function") failures.push("closePackagedLocalHost must return a promise");
  if (!sandbox.isUrlWithinBase("http://127.0.0.1:4173/", "http://127.0.0.1:4173")) failures.push("isUrlWithinBase must allow packaged local host root");
  if (!sandbox.isUrlWithinBase("http://127.0.0.1:4173/assets/index.js", "http://127.0.0.1:4173")) failures.push("isUrlWithinBase must allow packaged local host assets");
  if (sandbox.isUrlWithinBase("https://example.com/", "http://127.0.0.1:4173")) failures.push("isUrlWithinBase must reject remote origins");
} catch (error) {
  failures.push(`electron helper evaluation failed: ${error instanceof Error ? error.message : String(error)}`);
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("electron scaffold verification passed");
