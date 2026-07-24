import { describe, expect, it } from "vitest";
import { createCoreApi } from "../domain/coreApi";
import type { OpenAiCompatibleLlmClient } from "../domain/llmClient";

function createClient(): OpenAiCompatibleLlmClient {
  return { completeText: async () => "", completeVision: async () => "" } as unknown as OpenAiCompatibleLlmClient;
}

describe("CoreApi.addManualFact", () => {
  it("创建 confirmed 手动事实，且 getState() 能看到、持久化生效", () => {
    const stored: Record<string, string> = {};
    const api = createCoreApi({
      client: createClient(),
      storage: {
        getItem: (key) => stored[key] ?? null,
        setItem: (key, value) => {
          stored[key] = value;
        },
        removeItem: (key) => {
          delete stored[key];
        }
      }
    });

    const before = api.getState();
    expect(before.factLibrary).toHaveLength(0);

    api.addManualFact({ content: "3年后端开发经验", category: "experience" });

    const after = api.getState();
    expect(after.factLibrary).toHaveLength(1);
    expect(after.factLibrary[0].status).toBe("confirmed");
    expect(after.factLibrary[0].sourceType).toBe("manual");
    expect(after.factLibrary[0].id).toBeDefined();
  });
});
