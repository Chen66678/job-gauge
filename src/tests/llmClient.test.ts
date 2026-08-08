import { afterEach, describe, expect, it, vi } from "vitest";
import { createLlmClient } from "../domain/llmClient";

function jsonResponse(status: number, payload: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    }
  } as Response;
}

function createFetchRecorder(responseFactory: (input: string, init: RequestInit) => Promise<Response>) {
  const calls: Array<{ input: string; init: RequestInit }> = [];
  return {
    calls,
    fetchImpl: async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const requestInit = init ?? {};
      calls.push({ input: url, init: requestInit });
      return responseFactory(url, requestInit);
    }
  };
}

describe("OpenAiCompatibleLlmClient", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses a 240-second default timeout when timeoutMs is omitted", async () => {
    vi.useFakeTimers();
    const client = createLlmClient({
      apiKey: "test-key",
      fetchImpl: (async (_input, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      })) as typeof fetch
    });

    const request = expect(client.completeText({ user: "hello" })).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(239_999);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await request;
  });

  // A present-but-meaningless timeoutMs (what an eval script computes from a malformed
  // PROBE_TIMEOUT_MS env var via `envValue ? Number(envValue) : undefined`) must fall back to the
  // 240s default rather than degrading into instant-timeout or never-timeout — either of which is
  // indistinguishable from the model provider itself being broken.
  it.each([
    ["abc", NaN],
    ["0", 0],
    ["-5", -5],
    [" ", 0],
    ["1e999", Infinity]
  ] as const)("falls back to the 240-second default when PROBE_TIMEOUT_MS=%s parses to %s", async (envValue, _parsed) => {
    vi.useFakeTimers();
    const parsedTimeoutMs = envValue ? Number(envValue) : undefined;
    const client = createLlmClient({
      apiKey: "test-key",
      timeoutMs: parsedTimeoutMs,
      fetchImpl: (async (_input, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      })) as typeof fetch
    });

    const request = expect(client.completeText({ user: "hello" })).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(239_999);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await request;
  });

  it("uses an explicitly provided timeoutMs instead of the default", async () => {
    vi.useFakeTimers();
    const client = createLlmClient({
      apiKey: "test-key",
      timeoutMs: 1_234,
      fetchImpl: (async (_input, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      })) as typeof fetch
    });

    const request = expect(client.completeText({ user: "hello" })).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(1_233);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await request;
  });

  it("sends a text chat-completions request with the expected shape", async () => {
    const recorder = createFetchRecorder(async () =>
      jsonResponse(200, {
        choices: [{ message: { content: "ok" } }]
      })
    );
    const client = createLlmClient({
      apiKey: "test-key",
      fetchImpl: recorder.fetchImpl as typeof fetch
    });

    const result = await client.completeText({
      system: "Return short answers.",
      user: "Say ok."
    });

    expect(result).toBe("ok");
    expect(recorder.calls).toHaveLength(1);
    expect(recorder.calls[0]?.input).toBe("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions");
    expect(recorder.calls[0]?.init.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer test-key"
    });
    expect(JSON.parse(String(recorder.calls[0]?.init.body))).toEqual({
      model: "qwen-plus",
      messages: [
        { role: "system", content: "Return short answers." },
        { role: "user", content: "Say ok." }
      ]
    });
  });

  it("sends a vision request with text and image_url content parts", async () => {
    const recorder = createFetchRecorder(async () =>
      jsonResponse(200, {
        choices: [{ message: { content: "OK" } }]
      })
    );
    const client = createLlmClient({
      apiKey: "test-key",
      fetchImpl: recorder.fetchImpl as typeof fetch
    });

    await client.completeVision({
      system: "Read visible text only.",
      user: "What text is in this image?",
      imageBase64: "abc123",
      mimeType: "image/png"
    });

    expect(JSON.parse(String(recorder.calls[0]?.init.body))).toEqual({
      model: "qwen-vl-max",
      messages: [
        { role: "system", content: "Read visible text only." },
        {
          role: "user",
          content: [
            { type: "text", text: "What text is in this image?" },
            {
              type: "image_url",
              image_url: {
                url: "data:image/png;base64,abc123"
              }
            }
          ]
        }
      ]
    });
  });

  it("requests json_object mode when responseFormatJson is enabled", async () => {
    const recorder = createFetchRecorder(async () =>
      jsonResponse(200, {
        choices: [{ message: { content: "{\"ok\":true}" } }]
      })
    );
    const client = createLlmClient({
      apiKey: "test-key",
      fetchImpl: recorder.fetchImpl as typeof fetch
    });

    const result = await client.completeText({
      user: "Say ok in json.",
      responseFormatJson: true
    });

    expect(result).toBe("{\"ok\":true}");
    expect(JSON.parse(String(recorder.calls[0]?.init.body))).toEqual({
      model: "qwen-plus",
      messages: [{ role: "system", content: "Respond in JSON." }, { role: "user", content: "Say ok in json." }],
      response_format: { type: "json_object" }
    });
  });

  it("adds a json instruction to the system message when json mode is enabled and the prompt does not mention json", async () => {
    const recorder = createFetchRecorder(async () =>
      jsonResponse(200, {
        choices: [{ message: { content: "{\"status\":\"ok\"}" } }]
      })
    );
    const client = createLlmClient({
      apiKey: "test-key",
      fetchImpl: recorder.fetchImpl as typeof fetch
    });

    await client.completeVision({
      system: "Extract the structured fields.",
      user: "Read this image.",
      imageBase64: "abc123",
      mimeType: "image/png",
      responseFormatJson: true
    });

    expect(JSON.parse(String(recorder.calls[0]?.init.body))).toEqual({
      model: "qwen-vl-max",
      messages: [
        { role: "system", content: "Extract the structured fields.\nRespond in JSON." },
        {
          role: "user",
          content: [
            { type: "text", text: "Read this image." },
            {
              type: "image_url",
              image_url: {
                url: "data:image/png;base64,abc123"
              }
            }
          ]
        }
      ],
      response_format: { type: "json_object" }
    });
  });

  it("maps auth failures from 401 and 403", async () => {
    const unauthorized = createLlmClient({
      apiKey: "test-key",
      fetchImpl: (async () => jsonResponse(401, { error: "unauthorized" })) as typeof fetch
    });
    const forbidden = createLlmClient({
      apiKey: "test-key",
      fetchImpl: (async () => jsonResponse(403, { error: "forbidden" })) as typeof fetch
    });

    await expect(unauthorized.completeText({ user: "hello" })).rejects.toMatchObject({
      code: "auth_failed",
      status: 401
    });
    await expect(forbidden.completeText({ user: "hello" })).rejects.toMatchObject({
      code: "auth_failed",
      status: 403
    });
  });

  it("maps rate limits from 429", async () => {
    const client = createLlmClient({
      apiKey: "test-key",
      fetchImpl: (async () => jsonResponse(429, { error: "rate limit" })) as typeof fetch
    });

    await expect(client.completeText({ user: "hello" })).rejects.toMatchObject({
      code: "rate_limited",
      status: 429
    });
  });

  it("maps network failures from fetch errors", async () => {
    const client = createLlmClient({
      apiKey: "test-key",
      fetchImpl: (async () => {
        throw new TypeError("fetch failed");
      }) as typeof fetch
    });

    await expect(client.completeText({ user: "hello" })).rejects.toMatchObject({
      code: "network_failure"
    });
  });

  it("maps timeout failures from aborted fetches", async () => {
    const client = createLlmClient({
      apiKey: "test-key",
      fetchImpl: (async () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        throw error;
      }) as typeof fetch
    });

    await expect(client.completeText({ user: "hello" })).rejects.toMatchObject({
      code: "timeout"
    });
  });

  it("maps invalid payload shapes and missing assistant text", async () => {
    const invalidShapeClient = createLlmClient({
      apiKey: "test-key",
      fetchImpl: (async () => jsonResponse(200, { output: "wrong" })) as typeof fetch
    });
    const missingTextClient = createLlmClient({
      apiKey: "test-key",
      fetchImpl: (async () =>
        jsonResponse(200, {
          choices: [{ message: { content: [] } }]
        })) as typeof fetch
    });

    await expect(invalidShapeClient.completeText({ user: "hello" })).rejects.toMatchObject({
      code: "invalid_response"
    });
    await expect(missingTextClient.completeText({ user: "hello" })).rejects.toMatchObject({
      code: "invalid_response"
    });
  });

  it("maps non-JSON response bodies to invalid_response", async () => {
    const client = createLlmClient({
      apiKey: "test-key",
      fetchImpl: (async () =>
        (({
          ok: true,
          status: 200,
          async json() {
            throw new Error("bad json");
          }
        }) as unknown as Response)) as typeof fetch
    });

    await expect(client.completeText({ user: "hello" })).rejects.toMatchObject({
      code: "invalid_response"
    });
  });
});
