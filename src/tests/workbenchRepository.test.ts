// 门⑤清理迁移说明：本文件原测试的仓储读写路径（createLocalStorageWorkbenchRepository /
// createFileBackedJsonWorkbenchRepository / assertSafeWorkbenchRepositoryData 等）已随
// storage.ts 的 WorkbenchData v1→v3 迁移逻辑一并删除（账本 #9，生产代码零引用，仅供自身
// 测试使用）。collectSensitiveRepositoryFindings 与 redactSecretValues 仍是活代码（分别
// 被 coreState.ts / coreApi.ts 引用），其原有测试用例逐字保留在此。
import { describe, expect, it } from "vitest";
import { collectSensitiveRepositoryFindings, redactSecretValues } from "../domain/workbenchRepository";

describe("workbench repository sensitive-data scanning", () => {
  it("detects credential-like strings in nested repository data", () => {
    const unsafe: Record<string, unknown> = {
      auditLog: [
        {
          id: "audit-secret",
          type: "settings_updated",
          createdAt: "2026-06-28T20:10:00.000Z",
          message: "bad",
          detail: "Authorization: Bearer sk-secret-value"
        }
      ]
    };

    expect(collectSensitiveRepositoryFindings(unsafe)).toContain("workbench.auditLog[0].detail");
  });

  it("flags forbidden raw-evidence keys regardless of nesting depth", () => {
    const unsafe = { profile: { rawHtml: "<html>platform page</html>" } };

    expect(collectSensitiveRepositoryFindings(unsafe)).toContain("workbench.profile.rawHtml");
  });

  it("redactSecretValues strips secret-looking fragments so the text passes the sensitive scan", () => {
    const text = "岗位职责\ntoken = abc123 secret\n要求 React，密钥形如 sk-abcdefgh1234。";
    const redacted = redactSecretValues(text);

    expect(collectSensitiveRepositoryFindings(redacted)).toEqual([]);
    expect(redacted).toContain("岗位职责");
    expect(redacted).toContain("要求 React");
    expect(redacted).not.toContain("abc123");
    expect(redacted).not.toContain("sk-abcdefgh1234");
  });
});
