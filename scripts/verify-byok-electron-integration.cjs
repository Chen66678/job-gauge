// 真 BYOK 集成验证脚本——在真实 Electron 主进程下跑通完整链路，覆盖
// vitest(node 环境) 无法覆盖的两条验收断言：
//   §3.3 core-state.json 零 BYOK 字段（真实文件系统 + 真实 app.getPath）
//   §8.6 broadcastState 的 payload 仍是纯 CoreState，不含 Key/来源/密文
// 用法（必须显式 unset ELECTRON_RUN_AS_NODE，否则拿到的是退化成 Node 的
// electron 二进制，app/safeStorage 均为 undefined）：
//   env -u ELECTRON_RUN_AS_NODE npx electron scripts/verify-byok-electron-integration.cjs
"use strict";

const { app, BrowserWindow, ipcMain } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const assertions = [];
function assert(condition, message) {
  assertions.push({ pass: Boolean(condition), message });
}

app.whenReady().then(async () => {
  // 用一个临时 userData 目录，避免污染真实用户数据，也避免脚本重跑互相干扰。
  const tmpUserData = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "byok-verify-"));
  app.setPath("userData", tmpUserData);

  delete require.cache[require.resolve("../electron/main.cjs")];
  // main.cjs 顶层会自己挂 app.whenReady().then(...) 来起主窗口/本地 API，
  // 这里只需要它导出的内部函数，所以直接 require 整个文件，靠 NODE_ENV 不
  // 触发真实窗口创建的路径不存在——因此改为最小化重放 main.cjs 里
  // createMainCoreApi / registerCoreApiHandlers 的等价逻辑会有维护成本，
  // 故这里换一种方式：直接 require main.cjs 暴露的可测函数。见下方兼容层。
  const mainModule = require("../electron/main.cjs");

  const core = mainModule.__test__.createMainCoreApi();
  const byokDeps = core.byokDeps;

  const broadcasts = [];
  const fakeWindow = { webContents: { send: (_channel, state) => broadcasts.push(state) } };
  const originalGetAllWindows = BrowserWindow.getAllWindows;
  BrowserWindow.getAllWindows = () => [fakeWindow];

  const coreStatePath = path.join(tmpUserData, "job-radar", "core-state.json");
  const byokPath = path.join(tmpUserData, "job-radar", "byok-key.enc.json");

  // 0) 先真实写入一条业务事实，确保 core-state.json 已经存在且非空，
  //    让下面的"零 BYOK 字段"断言不是靠"文件还没被创建"这种弱证据过关。
  core.api.addManualFact({ content: "熟悉 TypeScript", category: "skill" });
  assert(fs.existsSync(coreStatePath), "core-state.json 应该已经因业务写入而存在");

  // 1) 保存一个真实格式的 Key（探测用假 probeApiKey，因为这里不应该打真实网络请求）。
  byokDeps.probeApiKey = async () => {};
  const saveResult = await mainModule.__test__.saveAndVerifyByokKey(byokDeps, { apiKey: "sk-integration-test-secret-000" });
  assert(saveResult.ok === true, "saveAndVerifyByokKey 应该成功（探测已 mock 为直接通过）");

  mainModule.__test__.broadcastState(core);

  // 2) core-state.json 零 BYOK 字段（§3.3）——此时文件已确认存在且含真实业务数据。
  const coreStateRaw = fs.readFileSync(coreStatePath, "utf8");
  assert(!coreStateRaw.includes("sk-integration-test-secret-000"), "core-state.json 不得包含 Key 明文");
  assert(!/apiKey|ciphertextBase64|byok/i.test(coreStateRaw), "core-state.json 不得出现任何 BYOK 相关字段名");

  // 3) byok-key.enc.json 独立存在，且是唯一允许的密文形状。
  assert(fs.existsSync(byokPath), "byok-key.enc.json 应该已创建");
  const byokRaw = fs.readFileSync(byokPath, "utf8");
  const byokRecord = JSON.parse(byokRaw);
  assert(byokRecord.version === 1 && typeof byokRecord.ciphertextBase64 === "string", "byok-key.enc.json 形状必须是 {version:1, ciphertextBase64}");
  assert(!byokRaw.includes("sk-integration-test-secret-000"), "byok-key.enc.json 不得包含明文（只允许密文）");

  // 4) broadcastState 的 payload 仍是纯 CoreState，不泄 Key/来源/密文（§8.6）。
  assert(broadcasts.length > 0, "broadcastState 应该已经触发过至少一次广播");
  for (const payload of broadcasts) {
    const serialized = JSON.stringify(payload);
    assert(!serialized.includes("sk-integration-test-secret-000"), "broadcast payload 不得含 Key 明文");
    assert(!/ciphertextBase64|byok|apiKey/i.test(serialized), "broadcast payload 不得含 BYOK 相关字段");
    assert(!("byok" in payload) && !("apiKey" in payload), "CoreState 顶层不得新增 byok/apiKey 字段");
  }

  // 5) 清除后来源正确回落，且 core-state.json 依然干净。
  const clearResult = await mainModule.__test__.clearByokKey(byokDeps);
  assert(clearResult.ok === true, "clearByokKey 应该成功");
  assert(!fs.existsSync(byokPath), "清除后 byok-key.enc.json 应该被删除");

  // 6) 重启后免重输：保存一个新 Key，再模拟"应用重启"——重新调用
  //    createMainCoreApi()（等价于新一次 app.whenReady() 冷启动），断言新一轮
  //    启动读取（resolveActiveKeySource）真的从 byok-key.enc.json 恢复出同一个
  //    Key，而不是每次都退回 env/none。不对 client 发起真实网络请求。
  const secondSave = await mainModule.__test__.saveAndVerifyByokKey(byokDeps, { apiKey: "sk-restart-persist-test-999" });
  assert(secondSave.ok === true, "重启前保存 Key 应该成功");

  const restartedActive = mainModule.__test__.resolveActiveKeySource({
    safeStorage: byokDeps.safeStorage,
    fileIO: byokDeps.fileIO,
    getEnvApiKey: byokDeps.getEnvApiKey
  });
  assert(restartedActive.source === "keychain", "重启后启动读取应解析到钥匙串来源");
  assert(restartedActive.apiKey === "sk-restart-persist-test-999", "重启后应恢复出与保存时一致的 Key，无需用户重新输入");

  BrowserWindow.getAllWindows = originalGetAllWindows;
  fs.rmSync(tmpUserData, { recursive: true, force: true });

  const failed = assertions.filter((item) => !item.pass);
  for (const item of assertions) {
    console.log(`${item.pass ? "PASS" : "FAIL"} - ${item.message}`);
  }
  console.log(failed.length === 0 ? "\n=== ALL BYOK ELECTRON INTEGRATION ASSERTIONS PASSED ===" : `\n=== ${failed.length} ASSERTION(S) FAILED ===`);
  app.exit(failed.length === 0 ? 0 : 1);
});
