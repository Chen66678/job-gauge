"use strict";

const ALLOWED_ORIGIN = "chrome-extension://abcdefghijklmnopqrstuvwxyzabcdef";
const TOKEN = "resume-image-api-test-token-000000000000";
const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

(async () => {
  const mainModule = require("../electron/main.cjs");
  const core = {
    api: {
      renderResumeImage: async () => `data:image/png;base64,${PNG_BYTES.toString("base64")}`
    }
  };

  try {
    const state = await mainModule.__test__.startJobApi(core, TOKEN, [0]);
    const endpoint = `${state.url}/api/resume-image?jobId=job-1`;

    const noTokenResponse = await fetch(endpoint, {
      headers: { Origin: ALLOWED_ORIGIN }
    });
    assert(noTokenResponse.status === 403, "GET without token must return 403");

    const wrongTokenResponse = await fetch(endpoint, {
      headers: { Origin: ALLOWED_ORIGIN, "X-Radar-Token": "wrong-token" }
    });
    assert(wrongTokenResponse.status === 403, "GET with wrong token must return 403");

    const successResponse = await fetch(endpoint, {
      headers: { Origin: ALLOWED_ORIGIN, "X-Radar-Token": TOKEN }
    });
    const successBody = Buffer.from(await successResponse.arrayBuffer());
    assert(successResponse.status === 200, "GET with correct token must return 200");
    assert(successResponse.headers.get("content-type") === "image/png", "200 response must be image/png");
    assert(successBody.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])), "200 response must start with PNG magic bytes");

    const preflightResponse = await fetch(endpoint, {
      method: "OPTIONS",
      headers: {
        Origin: ALLOWED_ORIGIN,
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "X-Radar-Token"
      }
    });
    assert(preflightResponse.status === 204, "OPTIONS must return 204");
    assert(preflightResponse.headers.get("access-control-allow-origin") === ALLOWED_ORIGIN, "OPTIONS must allow the extension origin");
    assert(preflightResponse.headers.get("access-control-allow-methods") === "GET, OPTIONS", "OPTIONS must allow GET and OPTIONS");
    assert((preflightResponse.headers.get("access-control-allow-headers") ?? "").toLowerCase().includes("x-radar-token"), "OPTIONS must allow X-Radar-Token");

    const wrongMethodResponse = await fetch(endpoint, {
      method: "POST",
      headers: { Origin: ALLOWED_ORIGIN, "X-Radar-Token": TOKEN }
    });
    assert(wrongMethodResponse.status === 404, "POST must return 404");

    console.log("resume image API real HTTP verification passed");
    await mainModule.__test__.closeJobApi();
  } catch (error) {
    await mainModule.__test__.closeJobApi().catch(() => {});
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  }
})();
