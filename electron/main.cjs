const { app, BrowserWindow, dialog, ipcMain } = require("electron");
require("tsx/cjs");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { createCoreApi } = require("../src/domain/coreApi.ts");
const { createLlmClient } = require("../src/domain/llmClient.ts");
const { CORE_STATE_STORAGE_KEY } = require("../src/domain/coreState.ts");

const DEV_SERVER_URL = process.env.ELECTRON_RENDERER_URL;
const BUILT_RENDERER_ENTRY = path.join(__dirname, "..", "dist", "index.html");
const JOB_RADAR_DATA_DIR_NAME = "job-radar";
const LOCAL_HOST_BIND_ADDRESS = "127.0.0.1";
const JOB_API_PORTS = [8765, 8766, 8767];
const jobApiState = {
  server: null,
  status: "stopped",
  url: null,
  port: null
};

function createFileStorage(filePath) {
  return {
    getItem(key) {
      if (key !== CORE_STATE_STORAGE_KEY) return null;
      try {
        return fs.readFileSync(filePath, "utf8");
      } catch (error) {
        if (error && error.code === "ENOENT") return null;
        throw error;
      }
    },
    setItem(key, value) {
      if (key !== CORE_STATE_STORAGE_KEY) return;
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, value, "utf8");
    },
    removeItem(key) {
      if (key !== CORE_STATE_STORAGE_KEY) return;
      try {
        fs.unlinkSync(filePath);
      } catch (error) {
        if (!error || error.code !== "ENOENT") throw error;
      }
    }
  };
}

function createUnavailableLlmClient() {
  const unavailable = async () => {
    throw new Error("未配置模型 API key，暂时无法执行需要模型的操作。");
  };
  return { completeText: unavailable, completeVision: unavailable };
}

function createMainCoreApi() {
  const storage = createFileStorage(path.join(app.getPath("userData"), JOB_RADAR_DATA_DIR_NAME, "core-state.json"));
  const apiKey = process.env.DASHSCOPE_API_KEY?.trim();
  const client = apiKey ? createLlmClient({ apiKey }) : createUnavailableLlmClient();
  return { api: createCoreApi({ client, storage }), client };
}

const CORE_STATE_CHANGED_CHANNEL = "coreState:changed";

function broadcastState(core) {
  const state = core.api.getState();
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(CORE_STATE_CHANGED_CHANNEL, state);
  }
}

function registerCoreApiHandlers(core) {
  const invoke = (methodName, handler) => {
    ipcMain.handle(`coreApi:${methodName}`, async (_event, ...args) => {
      try {
        const result = await handler(...args);
        broadcastState(core);
        return result;
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
    });
  };

  invoke("getState", () => core.api.getState());
  invoke("ingestResume", (input) => core.api.ingestResume(input));
  invoke("setFactStatus", (factId, status) => core.api.setFactStatus(factId, status));
  invoke("setFactStatusBatch", (updates) => core.api.setFactStatusBatch(updates));
  invoke("setPreferencesFromText", (input) => core.api.setPreferencesFromText(input));
  invoke("evaluateJobFromJd", (input) => core.api.evaluateJobFromJd(input));
  invoke("setJobPinned", (jobId, pinned) => core.api.setJobPinned(jobId, pinned));
  invoke("buildResumeFollowUps", () => core.api.buildResumeFollowUps());
  invoke("applyResumeFollowUpAnswers", (questions, answers) => core.api.applyResumeFollowUpAnswers(questions, answers));
  invoke("buildFollowUps", (jobId) => core.api.buildFollowUps(jobId));
  invoke("applyFollowUpAnswers", (jobId, answers) => core.api.applyFollowUpAnswers(jobId, answers));
  invoke("reevaluateJob", (jobId) => core.api.reevaluateJob(jobId));
  invoke("draftMaterial", (jobId) => core.api.draftMaterial(jobId));
  invoke("exportResume", (jobId) => core.api.exportResume(jobId));
  invoke("preScreenJob", (jobId, keywords) => core.api.preScreenJob(jobId, keywords));
  invoke("diagnoseBatch", () => core.api.diagnoseBatch(core.client));
  invoke("clear", () => core.api.clear());
  invoke("addManualFact", (input) => core.api.addManualFact(input));
}

function isLoopbackAddress(address) {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function isAllowedOrigin(origin) {
  return typeof origin === "string" && /^(?:chrome|moz)-extension:\/\/[^/]+$/.test(origin);
}

function sendJson(response, statusCode, body, origin) {
  if (isAllowedOrigin(origin)) response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Vary", "Origin");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.writeHead(statusCode);
  response.end(JSON.stringify(body));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2 * 1024 * 1024) {
        reject(new Error("request body too large"));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("invalid JSON"));
      }
    });
    request.on("error", reject);
  });
}

async function startJobApi(core) {
  if (jobApiState.server) return jobApiState;
  for (const port of JOB_API_PORTS) {
    const server = http.createServer(async (request, response) => {
      const origin = request.headers.origin;
      if (request.method === "OPTIONS" && request.url === "/api/jobs") {
        if (origin && !isAllowedOrigin(origin)) return sendJson(response, 403, { error: "forbidden origin" });
        if (isAllowedOrigin(origin)) {
          response.setHeader("Access-Control-Allow-Origin", origin);
          response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
          response.setHeader("Access-Control-Allow-Headers", "Content-Type");
        }
        response.writeHead(204);
        return response.end();
      }
      if (request.url !== "/api/jobs" || request.method !== "POST") return sendJson(response, 404, { error: "not found" }, origin);
      if (!isLoopbackAddress(request.socket.remoteAddress)) return sendJson(response, 403, { error: "forbidden" }, origin);
      try {
        const input = await readJson(request);
        if (!input || typeof input !== "object" || typeof input.title !== "string" || typeof input.company !== "string" || typeof input.description !== "string") {
          return sendJson(response, 400, { error: "title, company, and description are required" }, origin);
        }
        // evaluateJobFromJd 对评估失败 fail-closed 到落盘记录（不抛），插件侧收到
        // 200 即代表"岗位已入库"，评估成功与否留给渲染进程读 evaluationError 展示。
        await core.api.evaluateJobFromJd({
          jdText: input.description,
          jobBase: {
            title: input.title,
            company: input.company,
            city: "",
            salaryK: [0, 0],
            companyTags: [],
            workAddress: typeof input.workAddress === "string" ? input.workAddress : null,
            sourceUrl: typeof input.sourceUrl === "string" ? input.sourceUrl : null
          }
        });
        broadcastState(core);
        return sendJson(response, 200, { ok: true }, origin);
      } catch (error) {
        return sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) }, origin);
      }
    });
    try {
      await new Promise((resolve, reject) => {
        const onError = (error) => { server.off("listening", onListening); reject(error); };
        const onListening = () => { server.off("error", onError); resolve(); };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(port, LOCAL_HOST_BIND_ADDRESS);
      });
      jobApiState.server = server;
      jobApiState.port = port;
      jobApiState.url = `http://${LOCAL_HOST_BIND_ADDRESS}:${port}`;
      jobApiState.status = "available";
      return jobApiState;
    } catch (error) {
      server.close();
      if (error?.code !== "EADDRINUSE") throw error;
    }
  }
  throw new Error("本地 API 端口 8765-8767 均被占用。");
}

function closeJobApi() {
  const server = jobApiState.server;
  if (!server) {
    jobApiState.status = "stopped";
    jobApiState.url = null;
    jobApiState.port = null;
    return Promise.resolve(false);
  }
  jobApiState.server = null;
  jobApiState.status = "stopping";
  jobApiState.url = null;
  jobApiState.port = null;
  return new Promise((resolveClose) => {
    server.close(() => {
      jobApiState.status = "stopped";
      resolveClose(true);
    });
  });
}

function createMainWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: "BOSS Local Job Radar",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.cjs")
    }
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, targetUrl) => {
    const isDevServer = DEV_SERVER_URL && targetUrl.startsWith(DEV_SERVER_URL);
    if (!isDevServer) {
      event.preventDefault();
    }
  });

  if (DEV_SERVER_URL && !app.isPackaged) {
    void mainWindow.loadURL(DEV_SERVER_URL);
    return;
  }

  void mainWindow.loadFile(BUILT_RENDERER_ENTRY);
}

app.whenReady().then(async () => {
  const core = createMainCoreApi();
  registerCoreApiHandlers(core);
  let apiError = null;
  try {
    await startJobApi(core);
  } catch (error) {
    jobApiState.status = "failed";
    apiError = error;
  }
  const mainWindow = createMainWindow();
  if (apiError) {
    void dialog.showMessageBox(mainWindow, { type: "error", title: "本地 API 启动失败", message: apiError.message });
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  void closeJobApi();
});
