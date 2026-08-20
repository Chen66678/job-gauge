import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import policy from "../electron/coreApiIpcPolicy.cjs";

const { CORE_API_IPC_MODE, shouldBroadcastCoreApiMethod } = policy;
const mainSource = readFileSync(new URL("../electron/main.cjs", import.meta.url), "utf8");
const registeredMethods = [...mainSource.matchAll(/\binvoke\("([^"]+)"/g)].map((match) => match[1]);

assert.deepEqual(
  [...registeredMethods].sort(),
  Object.keys(CORE_API_IPC_MODE).sort(),
  "every registered CoreApi IPC method must be classified exactly once"
);

for (const methodName of ["getState", "getReevaluationPreview", "getReconciliationPreview"]) {
  assert.equal(shouldBroadcastCoreApiMethod(methodName), false, `${methodName} must not broadcast state`);
}

for (const methodName of ["setJobPinned", "reevaluateJobs", "clearJobs"]) {
  assert.equal(shouldBroadcastCoreApiMethod(methodName), true, `${methodName} must broadcast state`);
}

assert.throws(
  () => shouldBroadcastCoreApiMethod("unclassifiedMethod"),
  /not classified/,
  "new IPC methods must fail closed until their broadcast behavior is classified"
);

console.log("electron IPC broadcast policy verification passed");
