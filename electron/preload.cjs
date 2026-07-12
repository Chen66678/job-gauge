const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("bossLocalShell", {
  runtime: "electron",
  shell: "desktop",
  localHost: "available",
  storage: {
    jobRadar: "appData/userData",
    exposesFilePath: false,
    exposesBlobContents: false
  },
  noPlatformAutomation: true,
  noCredentialAccess: true
});
