const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const DEV_SERVER_URL = process.env.ELECTRON_RENDERER_URL;
const BUILT_RENDERER_ENTRY = path.join(__dirname, "..", "dist", "index.html");
const BUILT_RENDERER_DIR_URL = pathToFileURL(path.dirname(BUILT_RENDERER_ENTRY)).href;
const BUILT_RENDERER_ENTRY_URL = pathToFileURL(BUILT_RENDERER_ENTRY).href;
const JOB_RADAR_DATA_DIR_NAME = "job-radar";
const LOCAL_HOST_BIND_ADDRESS = "127.0.0.1";
const DEFAULT_PACKAGED_LOCAL_HOST_PORT = 4173;
const packagedLocalHostState = {
  server: null,
  status: "stopped",
  url: null,
  port: null
};

function resolveJobRadarDataDir(userDataPath) {
  if (!userDataPath || typeof userDataPath !== "string") {
    throw new Error("userDataPath is required");
  }
  return path.join(userDataPath, JOB_RADAR_DATA_DIR_NAME);
}

function buildPackagedLocalHostOptions(userDataPath, extraOptions = {}) {
  return {
    distDir: path.join(__dirname, "..", "dist"),
    jobRadarDataDir: resolveJobRadarDataDir(userDataPath),
    host: LOCAL_HOST_BIND_ADDRESS,
    port: DEFAULT_PACKAGED_LOCAL_HOST_PORT,
    ...extraOptions
  };
}

async function startPackagedLocalHost(localHostState, options) {
  if (localHostState.server) {
    return localHostState;
  }
  localHostState.status = "starting";
  const hostModuleUrl = pathToFileURL(path.join(__dirname, "..", "scripts", "local-provider-proxy-host.mjs")).href;
  const { startLocalProviderProxyHost } = await import(hostModuleUrl);
  const server = startLocalProviderProxyHost(options);
  const port = Number(options.port ?? DEFAULT_PACKAGED_LOCAL_HOST_PORT);
  await waitForServerListening(server);
  localHostState.server = server;
  localHostState.port = port;
  localHostState.url = `http://${LOCAL_HOST_BIND_ADDRESS}:${port}`;
  localHostState.status = "available";
  return localHostState;
}

function waitForServerListening(server) {
  if (server.listening) return Promise.resolve();
  return new Promise((resolveListening, rejectListening) => {
    const cleanup = () => {
      server.off("listening", onListening);
      server.off("error", onError);
    };
    const onListening = () => {
      cleanup();
      resolveListening();
    };
    const onError = (error) => {
      cleanup();
      rejectListening(error);
    };
    server.once("listening", onListening);
    server.once("error", onError);
  });
}

function closePackagedLocalHost(localHostState) {
  const server = localHostState.server;
  if (!server) {
    localHostState.status = "stopped";
    localHostState.url = null;
    localHostState.port = null;
    return Promise.resolve(false);
  }
  localHostState.server = null;
  localHostState.status = "stopping";
  localHostState.url = null;
  localHostState.port = null;
  return new Promise((resolveClose) => {
    server.close(() => {
      localHostState.status = "stopped";
      resolveClose(true);
    });
  });
}

function isUrlWithinBase(targetUrl, baseUrl) {
  if (!baseUrl) return false;
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  return targetUrl === normalizedBase || targetUrl === `${normalizedBase}/` || targetUrl.startsWith(`${normalizedBase}/`);
}

function createMainWindow(packagedRendererUrl = null) {
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
    const isBuiltRenderer = targetUrl === BUILT_RENDERER_ENTRY_URL || targetUrl.startsWith(`${BUILT_RENDERER_DIR_URL}/`);
    const isPackagedLocalHost = isUrlWithinBase(targetUrl, packagedRendererUrl);
    if (!isDevServer && !isBuiltRenderer && !isPackagedLocalHost) {
      event.preventDefault();
    }
  });

  if (DEV_SERVER_URL && !app.isPackaged) {
    void mainWindow.loadURL(DEV_SERVER_URL);
    return;
  }

  if (packagedRendererUrl) {
    void mainWindow.loadURL(packagedRendererUrl);
    return;
  }

  void mainWindow.loadFile(BUILT_RENDERER_ENTRY);
}

app.whenReady().then(async () => {
  const packagedLocalHostOptions = buildPackagedLocalHostOptions(app.getPath("userData"));
  app.jobRadarLocalHostOptions = packagedLocalHostOptions;
  let packagedRendererUrl = null;
  try {
    const startedLocalHost = await startPackagedLocalHost(packagedLocalHostState, packagedLocalHostOptions);
    packagedRendererUrl = startedLocalHost.url;
  } catch {
    packagedLocalHostState.status = "failed";
  }
  createMainWindow(packagedRendererUrl);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow(packagedLocalHostState.url);
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  void closePackagedLocalHost(packagedLocalHostState);
});
