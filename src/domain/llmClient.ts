import { isRecord } from "./shared";

export type LlmClientErrorCode =
  | "timeout"
  | "auth_failed"
  | "rate_limited"
  | "network_failure"
  | "invalid_response";

export class LlmClientError extends Error {
  readonly code: LlmClientErrorCode;
  readonly status: number | null;

  constructor(code: LlmClientErrorCode, message: string, status: number | null = null) {
    super(message);
    this.name = "LlmClientError";
    this.code = code;
    this.status = status;
  }
}

export interface LlmClientConfig {
  baseUrl?: string;
  apiKey: string;
  textModel?: string;
  visionModel?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface CompleteTextInput {
  system?: string;
  user: string;
  responseFormatJson?: boolean;
}

export interface CompleteVisionInput {
  system?: string;
  user: string;
  imageBase64: string;
  mimeType: string;
  responseFormatJson?: boolean;
}

interface ChatCompletionsResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
}

interface ChatMessage {
  role: "system" | "user";
  content: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
}

const DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const DEFAULT_TEXT_MODEL = "qwen-plus";
const DEFAULT_VISION_MODEL = "qwen-vl-max";
// A failed early cutoff discards the user's work and burns another model call, while waiting longer
// for a genuinely stuck request costs only bounded time. Observed latency clusters around 155s,
// with tail samples at 182788ms and 183621ms, so 240s leaves 31% headroom without waiting forever.
const DEFAULT_TIMEOUT_MS = 240_000;

export class OpenAiCompatibleLlmClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly textModel: string;
  private readonly visionModel: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(config: LlmClientConfig) {
    if (!config.apiKey.trim()) {
      throw new LlmClientError("auth_failed", "Missing API key.");
    }

    this.baseUrl = normalizeBaseUrl(config.baseUrl ?? DEFAULT_BASE_URL);
    this.apiKey = config.apiKey;
    this.textModel = config.textModel ?? DEFAULT_TEXT_MODEL;
    this.visionModel = config.visionModel ?? DEFAULT_VISION_MODEL;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch;

    if (!this.fetchImpl) {
      throw new LlmClientError("network_failure", "Fetch is unavailable in this runtime.");
    }
  }

  async completeText(input: CompleteTextInput): Promise<string> {
    const response = await this.sendChatCompletion({
      model: this.textModel,
      messages: buildTextMessages(input),
      responseFormatJson: input.responseFormatJson
    });
    return extractAssistantText(response);
  }

  async completeVision(input: CompleteVisionInput): Promise<string> {
    const response = await this.sendChatCompletion({
      model: this.visionModel,
      messages: buildVisionMessages(input),
      responseFormatJson: input.responseFormatJson
    });
    return extractAssistantText(response);
  }

  private async sendChatCompletion(input: {
    model: string;
    messages: ChatMessage[];
    responseFormatJson?: boolean;
  }): Promise<ChatCompletionsResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      let response: Response;
      try {
        response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`
          },
          body: JSON.stringify({
            model: input.model,
            messages: input.messages,
            ...(input.responseFormatJson ? { response_format: { type: "json_object" } } : {})
          }),
          signal: controller.signal
        });
      } catch (error) {
        throw mapTransportError(error);
      }

      if (!response.ok) {
        throw mapHttpError(response.status);
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new LlmClientError("invalid_response", "Model response was not valid JSON.");
      }

      if (!isChatCompletionsResponse(payload)) {
        throw new LlmClientError("invalid_response", "Model response did not match the chat completions shape.");
      }

      return payload;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function createLlmClient(config: LlmClientConfig): OpenAiCompatibleLlmClient {
  return new OpenAiCompatibleLlmClient(config);
}

function buildTextMessages(input: CompleteTextInput): ChatMessage[] {
  const messages: ChatMessage[] = [];
  const system = withJsonInstruction(input.system, input.responseFormatJson);
  if (system) {
    messages.push({ role: "system", content: system });
  }
  messages.push({ role: "user", content: input.user });
  return messages;
}

function buildVisionMessages(input: CompleteVisionInput): ChatMessage[] {
  const messages: ChatMessage[] = [];
  const system = withJsonInstruction(input.system, input.responseFormatJson);
  if (system) {
    messages.push({ role: "system", content: system });
  }
  messages.push({
    role: "user",
    content: [
      { type: "text", text: input.user },
      {
        type: "image_url",
        image_url: {
          url: `data:${input.mimeType};base64,${input.imageBase64}`
        }
      }
    ]
  });
  return messages;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function withJsonInstruction(system: string | undefined, responseFormatJson: boolean | undefined): string | null {
  const trimmed = system?.trim() ?? "";
  if (!responseFormatJson) {
    return trimmed || null;
  }
  if (/json/i.test(trimmed)) {
    return trimmed || null;
  }
  const suffix = "Respond in JSON.";
  return trimmed ? `${trimmed}\n${suffix}` : suffix;
}

function extractAssistantText(response: ChatCompletionsResponse): string {
  const content = response.choices?.[0]?.message?.content;
  if (typeof content === "string" && content.trim()) {
    return content;
  }
  if (Array.isArray(content)) {
    const joined = content
      .filter((item) => item.type === "text" && typeof item.text === "string")
      .map((item) => item.text?.trim() ?? "")
      .filter(Boolean)
      .join("\n");
    if (joined) {
      return joined;
    }
  }
  throw new LlmClientError("invalid_response", "Model response did not include assistant text.");
}

function mapTransportError(error: unknown): LlmClientError {
  if (isAbortError(error)) {
    return new LlmClientError("timeout", "Model request timed out.");
  }
  return new LlmClientError("network_failure", "Unable to reach the model provider.");
}

function mapHttpError(status: number): LlmClientError {
  if (status === 401 || status === 403) {
    return new LlmClientError("auth_failed", "Model provider rejected the API key.", status);
  }
  if (status === 429) {
    return new LlmClientError("rate_limited", "Model provider rate limited the request.", status);
  }
  return new LlmClientError("invalid_response", `Model provider returned HTTP ${status}.`, status);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function isChatCompletionsResponse(value: unknown): value is ChatCompletionsResponse {
  if (!isRecord(value) || !Array.isArray(value.choices) || value.choices.length === 0) {
    return false;
  }

  const firstChoice = value.choices[0];
  if (!isRecord(firstChoice) || !isRecord(firstChoice.message)) {
    return false;
  }

  const content = firstChoice.message.content;
  if (typeof content === "string") {
    return true;
  }

  return (
    Array.isArray(content) &&
    content.every((item) => isRecord(item) && typeof item.type === "string" && (item.text === undefined || typeof item.text === "string"))
  );
}
