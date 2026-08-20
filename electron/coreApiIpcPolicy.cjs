"use strict";

// IPC 查询只返回数据；只有确实可能修改 CoreState 的命令才触发状态广播。
// 新增 CoreApi IPC 时必须在这里显式分类，避免只读查询意外形成广播闭环。
const CORE_API_IPC_MODE = Object.freeze({
  getState: "query",
  getReevaluationPreview: "query",
  getReconciliationPreview: "query",
  buildResumeFollowUps: "query",
  buildFollowUps: "query",
  draftMaterial: "query",
  renderResumeImage: "query",

  ingestResume: "command",
  setFactStatus: "command",
  setFactStatusBatch: "command",
  setPreferencesFromText: "command",
  setPreferenceRuleSet: "command",
  setAutoReevaluateRecentCount: "command",
  reevaluateJobs: "command",
  evaluateJobFromJd: "command",
  setJobPinned: "command",
  applyResumeFollowUpAnswers: "command",
  applyFollowUpAnswers: "command",
  reevaluateJob: "command",
  addManualFact: "command",
  clearFactLibrary: "command",
  clearJobs: "command",
  deleteFact: "command",
  dismissFactConflict: "command",
  resolveFactConflict: "command"
});

function shouldBroadcastCoreApiMethod(methodName) {
  const mode = CORE_API_IPC_MODE[methodName];
  if (!mode) throw new Error(`CoreApi IPC method is not classified: ${methodName}`);
  return mode === "command";
}

module.exports = { CORE_API_IPC_MODE, shouldBroadcastCoreApiMethod };
