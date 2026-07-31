import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("GET /api/resume-image", () => {
  it("通过真实 HTTP 验证鉴权、PNG 响应、CORS 和方法限制", () => {
    const result = spawnSync(process.execPath, ["scripts/verify-resume-image-api.cjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        BYOK_MAIN_TEST_MODE: "1"
      }
    });

    expect(result.error).toBeUndefined();
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("resume image API real HTTP verification passed");
  });
});
