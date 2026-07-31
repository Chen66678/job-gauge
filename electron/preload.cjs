const { contextBridge, ipcRenderer } = require("electron");

const invokeCoreApi = (methodName, ...args) => ipcRenderer.invoke(`coreApi:${methodName}`, ...args);

const CORE_STATE_CHANGED_CHANNEL = "coreState:changed";

contextBridge.exposeInMainWorld("coreApi", {
  getState: () => invokeCoreApi("getState"),
  ingestResume: (input) => invokeCoreApi("ingestResume", input),
  setFactStatus: (factId, status) => invokeCoreApi("setFactStatus", factId, status),
  setFactStatusBatch: (updates) => invokeCoreApi("setFactStatusBatch", updates),
  setPreferencesFromText: (input) => invokeCoreApi("setPreferencesFromText", input),
  evaluateJobFromJd: (input) => invokeCoreApi("evaluateJobFromJd", input),
  setJobPinned: (jobId, pinned) => invokeCoreApi("setJobPinned", jobId, pinned),
  buildResumeFollowUps: () => invokeCoreApi("buildResumeFollowUps"),
  applyResumeFollowUpAnswers: (questions, answers) => invokeCoreApi("applyResumeFollowUpAnswers", questions, answers),
  buildFollowUps: (jobId) => invokeCoreApi("buildFollowUps", jobId),
  applyFollowUpAnswers: (jobId, answers) => invokeCoreApi("applyFollowUpAnswers", jobId, answers),
  reevaluateJob: (jobId) => invokeCoreApi("reevaluateJob", jobId),
  draftMaterial: (jobId) => invokeCoreApi("draftMaterial", jobId),
  exportResume: (jobId) => invokeCoreApi("exportResume", jobId),
  renderResumeImage: (jobId) => invokeCoreApi("renderResumeImage", jobId),
  preScreenJob: (jobId, keywords) => invokeCoreApi("preScreenJob", jobId, keywords),
  diagnoseBatch: () => invokeCoreApi("diagnoseBatch"),
  clear: () => invokeCoreApi("clear"),
  addManualFact: (input) => invokeCoreApi("addManualFact", input),
  clearFactLibrary: () => invokeCoreApi("clearFactLibrary"),
  deleteFact: (factId) => invokeCoreApi("deleteFact", factId),
  saveAndVerifyByokKey: (request) => invokeCoreApi("saveAndVerifyByokKey", request),
  getByokKeyStatus: () => invokeCoreApi("getByokKeyStatus"),
  clearByokKey: () => invokeCoreApi("clearByokKey"),
  getLocalApiToken: () => invokeCoreApi("getLocalApiToken"),
  onStateChanged: (listener) => {
    const handler = (_event, state) => listener(state);
    ipcRenderer.on(CORE_STATE_CHANGED_CHANNEL, handler);
    return () => ipcRenderer.removeListener(CORE_STATE_CHANGED_CHANNEL, handler);
  }
});

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
