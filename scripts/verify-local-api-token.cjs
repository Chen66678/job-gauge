// 派工④集成验证脚本——在真实 Electron 主进程下起真实本地 HTTP server，
// 用真实 fetch 打过去，验证 token 鉴权链路（Host→Origin→回环→token）、
// CORS 预检、token 持久化、以及 broadcast/日志/core-state 不泄 token。
// 用法：
//   BYOK_MAIN_TEST_MODE=1 env -u ELECTRON_RUN_AS_NODE npx electron scripts/verify-local-api-token.cjs
"use strict";

const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const assertions = [];
function assert(condition, message) {
  assertions.push({ pass: Boolean(condition), message });
}

const ALLOWED_ORIGIN = "chrome-extension://abcdefghijklmnopqrstuvwxyzabcdef";

app.whenReady().then(async () => {
  const tmpUserData = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "byok-token-verify-"));
  app.setPath("userData", tmpUserData);

  delete require.cache[require.resolve("../electron/main.cjs")];
  const mainModule = require("../electron/main.cjs");

  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => {
    logs.push(args.join(" "));
    originalLog(...args);
  };

  const core = mainModule.__test__.createMainCoreApi();
  const token = core.localApiToken;
  assert(typeof token === "string" && token.length >= 32, "启动应生成 >=32 字符的 token");

  const tokenPath = path.join(tmpUserData, "job-radar", "local-api-token.json");
  assert(fs.existsSync(tokenPath), "local-api-token.json 应该已创建");

  const broadcasts = [];
  const fakeWindow = { webContents: { send: (_channel, state) => broadcasts.push(state) } };
  const originalGetAllWindows = BrowserWindow.getAllWindows;
  BrowserWindow.getAllWindows = () => [fakeWindow];

  await mainModule.__test__.startJobApi(core, token);
  const jobApiState = mainModule.__test__.createMainCoreApi === mainModule.__test__.createMainCoreApi ? null : null;
  void jobApiState;

  // 从模块内部状态里探测实际监听端口：直接用 fetch 依次尝试三个候选端口，
  // 找到第一个能连上的，而不是假设固定 8765（该端口可能被占用触发回退）。
  const CANDIDATE_PORTS = [8765, 8766, 8767];
  let activePort = null;
  for (const port of CANDIDATE_PORTS) {
    try {
      await fetch(`http://127.0.0.1:${port}/api/jobs`, { method: "OPTIONS", headers: { Origin: ALLOWED_ORIGIN } });
      activePort = port;
      break;
    } catch {
      continue;
    }
  }
  assert(activePort !== null, "应该能连上 8765-8767 中的某个端口");

  const baseUrl = `http://127.0.0.1:${activePort}/api/jobs`;
  const validPayload = { title: "测试岗位", company: "测试公司", description: "岗位描述" };

  // 1) 无 token → 403
  const noTokenResponse = await fetch(baseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ALLOWED_ORIGIN },
    body: JSON.stringify(validPayload)
  });
  assert(noTokenResponse.status === 403, "无 token 应返回 403");

  // 2) 错 token → 403
  const wrongTokenResponse = await fetch(baseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ALLOWED_ORIGIN, "X-Radar-Token": "wrong-token-value" },
    body: JSON.stringify(validPayload)
  });
  assert(wrongTokenResponse.status === 403, "错误 token 应返回 403");

  // 3) 正确 token → 200
  const correctTokenResponse = await fetch(baseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ALLOWED_ORIGIN, "X-Radar-Token": token },
    body: JSON.stringify(validPayload)
  });
  assert(correctTokenResponse.status === 200, "正确 token 应返回 200");
  const correctBody = await correctTokenResponse.json();
  assert(correctBody.ok === true, "正确 token 的响应体应为 { ok: true }");

  // 4) 预检 OPTIONS 带 X-Radar-Token 不被 CORS 挡
  const preflightResponse = await fetch(baseUrl, {
    method: "OPTIONS",
    headers: {
      Origin: ALLOWED_ORIGIN,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "Content-Type, X-Radar-Token"
    }
  });
  assert(preflightResponse.status === 204, "预检 OPTIONS 应返回 204");
  const allowHeaders = preflightResponse.headers.get("access-control-allow-headers") ?? "";
  assert(allowHeaders.toLowerCase().includes("x-radar-token"), "Access-Control-Allow-Headers 必须包含 X-Radar-Token");

  // 5) 既有三道防线仍生效：错误 Host / 非法 Origin
  const wrongHostResponse = await fetch(baseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ALLOWED_ORIGIN, "X-Radar-Token": token, Host: "evil.example.com" },
    body: JSON.stringify(validPayload)
  }).catch(() => null);
  // Node fetch 不允许覆盖 Host 头（会被 undici 忽略/拒绝），因此这里改用更
  // 直接的方式验证 Host 校验逻辑本身仍在：读取源码确认 isAllowedHost 调用
  // 顺序未被本次改动移动或删除。
  void wrongHostResponse;
  const mainSource = fs.readFileSync(path.join(__dirname, "..", "electron", "main.cjs"), "utf8");
  const hostCheckIndex = mainSource.indexOf("isAllowedHost(request.headers.host, port)");
  const originCheckIndex = mainSource.indexOf("isAllowedOrigin(origin)) return sendJson(response, 403");
  const loopbackCheckIndex = mainSource.indexOf("isLoopbackAddress(request.socket.remoteAddress)");
  const tokenCheckIndex = mainSource.indexOf('request.headers["x-radar-token"] !== localApiToken');
  assert(
    hostCheckIndex > -1 && originCheckIndex > hostCheckIndex && loopbackCheckIndex > originCheckIndex && tokenCheckIndex > loopbackCheckIndex,
    "四道防线顺序必须是 Host → Origin → 回环 → token（源码位置断言）"
  );

  const disallowedOriginResponse = await fetch(baseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://evil.example.com", "X-Radar-Token": token },
    body: JSON.stringify(validPayload)
  });
  assert(disallowedOriginResponse.status === 403, "非白名单 Origin 即便带正确 token 也应 403（Origin 检查在 token 检查之前）");

  // 6) token 重启后不变
  mainModule.__test__.broadcastState(core);
  const restartedCore = mainModule.__test__.createMainCoreApi();
  assert(restartedCore.localApiToken === token, "重启（重新创建 core）后 token 应保持不变，插件无需重配");

  // 7) token 不出现在 broadcast payload / core-state.json / 日志
  core.api.addManualFact({ content: "熟悉 TypeScript", category: "skill" });
  mainModule.__test__.broadcastState(core);
  for (const payload of broadcasts) {
    const serialized = JSON.stringify(payload);
    assert(!serialized.includes(token), "broadcast payload 不得包含 token");
  }
  const coreStatePath = path.join(tmpUserData, "job-radar", "core-state.json");
  if (fs.existsSync(coreStatePath)) {
    const coreStateRaw = fs.readFileSync(coreStatePath, "utf8");
    assert(!coreStateRaw.includes(token), "core-state.json 不得包含 token");
  }
  const joinedLogs = logs.join("\n");
  assert(!joinedLogs.includes(token), "console.log 输出不得包含 token 明文");

  console.log = originalLog;
  BrowserWindow.getAllWindows = originalGetAllWindows;
  await mainModule.__test__.closeJobApi();
  fs.rmSync(tmpUserData, { recursive: true, force: true });

  const failed = assertions.filter((item) => !item.pass);
  for (const item of assertions) {
    console.log(`${item.pass ? "PASS" : "FAIL"} - ${item.message}`);
  }
  console.log(failed.length === 0 ? "\n=== ALL LOCAL API TOKEN ASSERTIONS PASSED ===" : `\n=== ${failed.length} ASSERTION(S) FAILED ===`);
  app.exit(failed.length === 0 ? 0 : 1);
});
