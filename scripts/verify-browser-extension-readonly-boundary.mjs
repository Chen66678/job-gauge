import fs from "node:fs";
import path from "node:path";

const failures = [];
const fail = (message) => failures.push(message);

const root = path.resolve("browser-extension");
const requiredFiles = [
  "wxt.config.ts",
  "entrypoints/background.ts",
  "entrypoints/content.ts",
  "entrypoints/options/main.ts",
  "entrypoints/popup/main.ts",
  "entrypoints/sidepanel/main.ts",
  "entrypoints/shared/localApiToken.ts"
];
const read = (relativePath) => {
  const filePath = path.join(root, relativePath);
  if (!fs.existsSync(filePath)) {
    fail(`missing ${relativePath}`);
    return "";
  }
  return fs.readFileSync(filePath, "utf8");
};

for (const file of requiredFiles) read(file);

const wxtConfig = read("wxt.config.ts");
const backgroundSource = read("entrypoints/background.ts");
const contentSource = read("entrypoints/content.ts");
const optionsSource = read("entrypoints/options/main.ts");
const popupSource = read("entrypoints/popup/main.ts");
const sidepanelSource = read("entrypoints/sidepanel/main.ts");

const allowedPermissions = new Set(["activeTab", "tabs", "storage", "clipboardWrite"]);
const permissionMatch = wxtConfig.match(/permissions:\s*\[([^\]]*)\]/s);
if (!permissionMatch) {
  fail("wxt.config.ts must declare permissions");
} else {
  const permissions = [...permissionMatch[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
  const disallowed = permissions.filter((permission) => !allowedPermissions.has(permission));
  if (disallowed.length > 0) fail(`permission not allowed: ${disallowed.join(", ")}`);
  for (const permission of allowedPermissions) {
    if (!permissions.includes(permission)) fail(`required permission missing: ${permission}`);
  }
}

const hostPermissionsMatch = wxtConfig.match(/host_permissions:\s*\[([^\]]*)\]/s);
if (!hostPermissionsMatch) {
  fail("wxt.config.ts must declare host_permissions");
} else {
  const hosts = [...hostPermissionsMatch[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
  const allowedHosts = ["https://www.zhipin.com/*", "http://127.0.0.1:*/*"];
  for (const host of hosts) {
    if (!allowedHosts.includes(host)) fail(`host permission not allowed: ${host}`);
  }
  for (const host of allowedHosts) {
    if (!hosts.includes(host)) fail(`required host permission missing: ${host}`);
  }
}

// Background 是唯一网络出口，且只能访问 127.0.0.1 的三个候选端口。
if (!backgroundSource.includes("Sole network egress point for this extension")) {
  fail("background.ts must document itself as the sole network egress point");
}
const fetchCalls = [...backgroundSource.matchAll(/\bfetch\s*\(\s*`([^`]+)`/g)].map((match) => match[1]);
if (fetchCalls.length === 0) fail("background.ts must call fetch to post job payloads");
for (const url of fetchCalls) {
  if (!url.includes("http://127.0.0.1:${port}")) fail(`background fetch must target loopback only, got: ${url}`);
}
if (/\bXMLHttpRequest\b|\bWebSocket\s*\(|\bEventSource\s*\(|\bnavigator\.sendBeacon\s*\(/.test(backgroundSource)) {
  fail("background.ts contains disallowed network primitive");
}

// Content script 只读采集：不点击、不提交、不导航，不访问 cookie/webRequest/scripting。
if (!contentSource.includes("READ-ONLY CONTRACT")) fail("content.ts must document the read-only contract");
if (!contentSource.includes("never clicks, submits, focuses, navigates")) fail("content.ts read-only contract text is incomplete");
const forbiddenContentPatterns = [
  [/\.click\s*\(/, "click automation"],
  [/\.submit\s*\(/, "form automation"],
  [/\bwindow\.open\s*\(/, "window.open navigation"],
  [/\blocation\.(href|assign|replace|reload)\s*=/, "location navigation"],
  [/\bchrome\.tabs\b/, "chrome.tabs navigation/control"],
  [/\bchrome\.cookies\b/, "chrome.cookies credential access"],
  [/\bchrome\.webRequest\b/, "chrome.webRequest interception"],
  [/\bchrome\.scripting\b/, "chrome.scripting injection"],
  [/\bchrome\.debugger\b/, "chrome.debugger/CDP access"],
  [/\bXMLHttpRequest\b/, "network primitive XMLHttpRequest"],
  [/\bfetch\s*\(/, "network primitive fetch"],
  [/\bWebSocket\s*\(/, "network primitive WebSocket"],
  [/\bnavigator\.sendBeacon\s*\(/, "network primitive navigator.sendBeacon"],
  [/document\.(body|documentElement)\.innerHTML\s*=/, "page innerHTML mutation"]
];
for (const [pattern, label] of forbiddenContentPatterns) {
  if (pattern.test(contentSource)) fail(`content.ts contains disallowed ${label}`);
}
if (!contentSource.includes("insertAdjacentElement('afterend', marker)")) {
  fail("content.ts must only inject its own collected marker");
}

// 非 background 页面/侧边栏/选项页不得发网络请求。
for (const [name, source] of [
  ["content.ts", contentSource],
  ["options/main.ts", optionsSource],
  ["popup/main.ts", popupSource],
  ["sidepanel/main.ts", sidepanelSource]
]) {
  if (/\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\s*\(|\bnavigator\.sendBeacon\s*\(/.test(source)) {
    fail(`${name} contains disallowed network primitive`);
  }
}

if (failures.length > 0) {
  console.error("browser extension readonly boundary verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("browser extension readonly boundary verification passed");
