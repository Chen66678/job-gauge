import fs from "node:fs";
import path from "node:path";

const EXTENSION_DIR = path.resolve("browser-extension/team084-boss-readonly-current-page-export");
const REQUIRED_FILES = ["manifest.json", "popup.html", "popup.js", "popup.css", "README.md"];
const ALLOWED_PERMISSIONS = new Set(["activeTab", "scripting"]);

const failures = [];

function fail(message) {
  failures.push(message);
}

function readText(relativePath) {
  const filePath = path.join(EXTENSION_DIR, relativePath);
  if (!fs.existsSync(filePath)) {
    fail(`missing ${relativePath}`);
    return "";
  }
  return fs.readFileSync(filePath, "utf8");
}

for (const file of REQUIRED_FILES) {
  if (!fs.existsSync(path.join(EXTENSION_DIR, file))) fail(`missing ${file}`);
}

const manifestText = readText("manifest.json");
let manifest = null;
try {
  manifest = JSON.parse(manifestText);
} catch (error) {
  fail(`manifest.json is not valid JSON: ${error.message}`);
}

if (manifest) {
  if (manifest.manifest_version !== 3) fail("manifest_version must be 3");
  if (manifest.action?.default_popup !== "popup.html") fail("manifest action.default_popup must be popup.html");

  const permissions = Array.isArray(manifest.permissions) ? manifest.permissions : [];
  for (const permission of permissions) {
    if (!ALLOWED_PERMISSIONS.has(permission)) fail(`permission not allowed: ${permission}`);
  }
  for (const permission of ALLOWED_PERMISSIONS) {
    if (!permissions.includes(permission)) fail(`required permission missing: ${permission}`);
  }

  if (Array.isArray(manifest.host_permissions) && manifest.host_permissions.length > 0) {
    fail(`host_permissions must be empty, got ${manifest.host_permissions.join(", ")}`);
  }
  if (!Array.isArray(manifest.host_permissions)) fail("host_permissions must be an empty array");

  const disallowedManifestKeys = [
    "background",
    "content_scripts",
    "externally_connectable",
    "oauth2",
    "declarative_net_request",
    "web_accessible_resources"
  ];
  for (const key of disallowedManifestKeys) {
    if (Object.hasOwn(manifest, key)) fail(`manifest key not allowed for readonly artifact: ${key}`);
  }
}

const popupHtml = readText("popup.html");
const popupJs = readText("popup.js");
const readme = readText("README.md");

const boundaryText = `${popupHtml}\n${readme}`.toLowerCase();
for (const requiredCopy of [
  "active tab",
  "user click",
  "no cookies",
  "no network",
  "no navigation",
  "no host permissions"
]) {
  if (!boundaryText.includes(requiredCopy)) fail(`missing boundary copy: ${requiredCopy}`);
}

const executablePatterns = [
  [/\bfetch\s*\(/, "network primitive fetch()"],
  [/\bXMLHttpRequest\b/, "network primitive XMLHttpRequest"],
  [/\bWebSocket\s*\(/, "network primitive WebSocket"],
  [/\bEventSource\s*\(/, "network primitive EventSource"],
  [/\bnavigator\.sendBeacon\s*\(/, "network primitive navigator.sendBeacon"],
  [/\bchrome\.cookies\b/, "chrome.cookies credential access"],
  [/\bchrome\.webRequest\b/, "chrome.webRequest interception"],
  [/\bchrome\.debugger\b/, "chrome.debugger/CDP access"],
  [/\bchrome\.declarativeNetRequest\b/, "declarativeNetRequest interception"],
  [/\bchrome\.identity\b/, "chrome.identity account access"],
  [/\bchrome\.storage\b/, "chrome.storage persistence"],
  [/\bchrome\.tabs\.(create|update|remove|reload|goBack|goForward)\s*\(/, "tab navigation/control"],
  [/\bwindow\.open\s*\(/, "window.open navigation"],
  [/\blocation\.(href|assign|replace|reload)\b/, "location navigation"],
  [/\bhistory\.(pushState|replaceState)\s*\(/, "history navigation"],
  [/\b(submit|dispatchEvent)\s*\(/, "form/event automation"],
  [/\b(setInterval|setTimeout)\s*\(/, "timer/retry primitive"],
  [/\bMutationObserver\b/, "DOM observer/injection primitive"],
  [/\b(eval|Function)\s*\(/, "dynamic code execution"],
  [/\bisTrusted\b/, "isTrusted spoofing hint"],
  [/\b(headless|stealth|evasion|anti[-_ ]?detect)\b/i, "anti-detection wording"],
  [/\b(captcha|safeguard|风控|验证码).{0,40}(bypass|solve|破解|绕过|规避)/i, "safeguard bypass wording"]
];

for (const [pattern, label] of executablePatterns) {
  if (pattern.test(popupJs)) fail(`popup.js contains disallowed ${label}`);
}

const injectedMutationPatterns = [
  /document\.(body|documentElement)\.(innerHTML|outerHTML|textContent)\s*=/,
  /\.appendChild\s*\(/,
  /\.removeChild\s*\(/,
  /\.insertAdjacentHTML\s*\(/,
  /\.setAttribute\s*\(/,
  /\.click\s*\(/,
  /\.submit\s*\(/
];

const executeScriptFuncMatch = popupJs.match(/func:\s*\(\)\s*=>\s*\(\{[\s\S]*?\}\)/);
const injectedFunctionText = executeScriptFuncMatch?.[0] ?? "";
if (!injectedFunctionText) fail("chrome.scripting.executeScript func block not found");
for (const pattern of injectedMutationPatterns) {
  if (pattern.test(injectedFunctionText)) fail(`injected page function contains DOM/action mutation pattern: ${pattern}`);
}

const allowedChromeApiPatterns = [
  /chrome\.tabs\.query\s*\(/g,
  /chrome\.scripting\.executeScript\s*\(/g
];
const chromeApiMatches = [...popupJs.matchAll(/\bchrome\.[A-Za-z0-9_.]+\s*\(/g)].map((match) => match[0]);
for (const call of chromeApiMatches) {
  if (!allowedChromeApiPatterns.some((pattern) => pattern.test(call))) fail(`chrome API call not allowlisted: ${call}`);
}

const executableActionTerms = /\b(send|upload|contact|chat|apply|batch|navigate|paginate|refresh|scrollTo|scrollIntoView|search)\b/i;
const executableActionMatches = popupJs
  .split("\n")
  .map((line, index) => ({ line: line.trim(), number: index + 1 }))
  .filter(({ line }) => executableActionTerms.test(line))
  .filter(({ line }) => !/redacted|sanitize|detectSensitiveFields|classifyPageShape|search results/i.test(line));
for (const match of executableActionMatches) {
  fail(`popup.js executable action wording/capability at line ${match.number}: ${match.line}`);
}

if (!/noNetworkCalls:\s*true/.test(popupJs)) fail("snapshot boundary must include noNetworkCalls: true");
if (!/noCredentialAccess:\s*true/.test(popupJs)) fail("snapshot boundary must include noCredentialAccess: true");
if (!/noDomMutation:\s*true/.test(popupJs)) fail("snapshot boundary must include noDomMutation: true");
if (!/readOnly:\s*true/.test(popupJs)) fail("snapshot boundary must include readOnly: true");
if (!/userInitiated:\s*true/.test(popupJs)) fail("snapshot boundary must include userInitiated: true");
if (!/activeTabOnly:\s*true/.test(popupJs)) fail("snapshot boundary must include activeTabOnly: true");

if (failures.length > 0) {
  console.error("browser extension readonly boundary verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("browser extension readonly boundary verification passed");
