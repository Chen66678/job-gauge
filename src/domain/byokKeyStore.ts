// 真 BYOK · Key 入钥匙串——实现依据 docs/byok-keychain-contract.md 全文，
// 逐条对照 §1(IPC 形状)/§2(safeStorage 数据形状)/§3(存放隔离)/§4(生命周期)/
// §5(优先级)/§6(热替)/§7(真验证)/§8(脱敏红线)。本模块框架无关（不 import
// electron），safeStorage/文件 I/O/探测函数均以依赖注入方式传入，使其可在
// vitest(node 环境)下用假实现完整覆盖全部安全断言，无需真实 Electron 进程。

import { LlmClientError } from "./llmClient";

export type ByokKeySource = "keychain" | "environment" | "none";

export type ByokErrorCode =
  | "auth_failed"
  | "network_failure"
  | "timeout"
  | "rate_limited"
  | "invalid_response"
  | "encryption_unavailable"
  | "invalid_input"
  | "internal_error";

export interface SaveAndVerifyByokKeyRequest {
  apiKey: string;
}

export interface ByokKeyStatus {
  configured: boolean;
  source: ByokKeySource;
}

export interface ByokSuccess extends ByokKeyStatus {
  ok: true;
}

export interface ByokFailure {
  ok: false;
  code: ByokErrorCode;
  message: string;
}

export type SaveAndVerifyByokKeyResult = ByokSuccess | ByokFailure;
export type ClearByokKeyResult = ByokSuccess | ByokFailure;

export interface ByokCoreApi {
  saveAndVerifyByokKey(request: SaveAndVerifyByokKeyRequest): Promise<SaveAndVerifyByokKeyResult>;
  getByokKeyStatus(): Promise<ByokKeyStatus>;
  clearByokKey(): Promise<ClearByokKeyResult>;
}

// 磁盘上唯一允许的密文格式（契约 §2）。
export interface ByokKeyEncryptedRecordV1 {
  version: 1;
  ciphertextBase64: string;
}

// 契约 §7.4 固定白名单文案——除此表之外的任何文本都不得作为失败结果的 message。
const BYOK_ERROR_MESSAGES: Record<ByokErrorCode, string> = {
  auth_failed: "API Key 无效或无权访问模型，请检查后重试。",
  network_failure: "无法连接模型服务，请检查网络后重试。",
  timeout: "验证请求超时，请稍后重试。",
  rate_limited: "模型服务当前限流，请稍后重试。",
  invalid_response: "模型服务返回异常，请稍后重试。",
  encryption_unavailable: "系统钥匙串不可用，无法安全保存 API Key。",
  invalid_input: "请输入 API Key。",
  internal_error: "无法完成 API Key 验证，请稍后重试。"
};

function failure(code: ByokErrorCode): ByokFailure {
  return { ok: false, code, message: BYOK_ERROR_MESSAGES[code] };
}

// §7.3：探测请求的契约输入固定为仅用于连通性验证的短文本，不得改动。
export const BYOK_PROBE_REQUEST = {
  system: "Reply with exactly OK.",
  user: "OK"
} as const;

export interface ByokSafeStorage {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

// 契约要求密文落盘为“独立文件”，且写入必须原子替换（§4.133.3）。原子性由
// 具体适配器实现（真实环境走 tmp 文件 + rename）；本接口只约定语义契约。
export interface ByokFileIO {
  /** 文件不存在返回 null，不是错误；读取失败也应返回 null（由上层视为“不可用”）。 */
  read(): string | null;
  /** 必须原子替换旧内容，不得先截断后写导致中间状态可被读到半截文件。 */
  write(content: string): void;
  /** 删除不存在的文件必须视为成功（幂等），不得抛错。 */
  remove(): void;
}

export interface ByokKeyManagerDeps {
  safeStorage: ByokSafeStorage;
  fileIO: ByokFileIO;
  getEnvApiKey: () => string | undefined;
  /** 复用现有 llmClient 的 completeText 发起探测；探测失败必须 throw（推荐 LlmClientError）。 */
  probeApiKey: (apiKey: string) => Promise<void>;
  /** 每当“当前生效来源”发生变化（保存成功 / 清除）时回调，供上层做 client 热替。 */
  onActiveKeyChanged?: (result: { source: ByokKeySource; apiKey: string | null }) => void;
  /** 仅用于记录不含敏感信息的白名单事件名，例如 "byok_verify_failed: auth_failed"。 */
  log?: (event: string) => void;
}

function decodeEncryptedRecord(raw: string): ByokKeyEncryptedRecordV1 | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as Record<string, unknown>).version !== 1 ||
    typeof (parsed as Record<string, unknown>).ciphertextBase64 !== "string"
  ) {
    return null;
  }
  return parsed as ByokKeyEncryptedRecordV1;
}

/**
 * 从钥匙串密文文件解出明文 Key。任何异常路径（文件不存在/schema 不符/
 * base64 无效/safeStorage 不可用/解密失败/解密为空）均归一为 null，绝不
 * 抛出、绝不把底层异常暴露给调用方（契约 §4.131 损坏降级要求）。
 */
function readKeychainKey(deps: Pick<ByokKeyManagerDeps, "safeStorage" | "fileIO">): string | null {
  let raw: string | null;
  try {
    raw = deps.fileIO.read();
  } catch {
    return null;
  }
  if (raw === null) return null;

  const record = decodeEncryptedRecord(raw);
  if (!record) return null;

  if (!deps.safeStorage.isEncryptionAvailable()) return null;

  try {
    const buffer = Buffer.from(record.ciphertextBase64, "base64");
    const decrypted = deps.safeStorage.decryptString(buffer);
    return decrypted ? decrypted : null;
  } catch {
    return null;
  }
}

function resolveEnvApiKey(raw: string | undefined): string | null {
  const trimmed = raw?.trim();
  return trimmed ? trimmed : null;
}

/** 契约 §5：有效钥匙串 Key > 有效 env Key > none。 */
export function resolveActiveKeySource(
  deps: Pick<ByokKeyManagerDeps, "safeStorage" | "fileIO" | "getEnvApiKey">
): { source: ByokKeySource; apiKey: string | null } {
  const keychainKey = readKeychainKey(deps);
  if (keychainKey) return { source: "keychain", apiKey: keychainKey };

  const envKey = resolveEnvApiKey(deps.getEnvApiKey());
  if (envKey) return { source: "environment", apiKey: envKey };

  return { source: "none", apiKey: null };
}

export async function getByokKeyStatus(
  deps: Pick<ByokKeyManagerDeps, "safeStorage" | "fileIO" | "getEnvApiKey">
): Promise<ByokKeyStatus> {
  const active = resolveActiveKeySource(deps);
  return { configured: active.source !== "none", source: active.source };
}

function mapProbeErrorToByokCode(error: unknown): ByokErrorCode {
  if (error instanceof LlmClientError) {
    switch (error.code) {
      case "auth_failed":
      case "network_failure":
      case "timeout":
      case "rate_limited":
      case "invalid_response":
        return error.code;
      default:
        return "internal_error";
    }
  }
  return "internal_error";
}

export async function saveAndVerifyByokKey(
  deps: ByokKeyManagerDeps,
  request: SaveAndVerifyByokKeyRequest
): Promise<SaveAndVerifyByokKeyResult> {
  try {
    const apiKey = request?.apiKey?.trim();
    if (!apiKey) return failure("invalid_input");

    try {
      await deps.probeApiKey(apiKey);
    } catch (error) {
      const code = mapProbeErrorToByokCode(error);
      deps.log?.(`byok_verify_failed: ${code}`);
      return failure(code);
    }

    if (!deps.safeStorage.isEncryptionAvailable()) {
      return failure("encryption_unavailable");
    }

    let ciphertextBase64: string;
    try {
      const encrypted = deps.safeStorage.encryptString(apiKey);
      ciphertextBase64 = encrypted.toString("base64");
    } catch {
      return failure("internal_error");
    }

    const record: ByokKeyEncryptedRecordV1 = { version: 1, ciphertextBase64 };
    try {
      deps.fileIO.write(JSON.stringify(record));
    } catch {
      return failure("internal_error");
    }

    deps.onActiveKeyChanged?.({ source: "keychain", apiKey });
    return { ok: true, configured: true, source: "keychain" };
  } catch {
    return failure("internal_error");
  }
}

export async function clearByokKey(
  deps: Pick<ByokKeyManagerDeps, "safeStorage" | "fileIO" | "getEnvApiKey" | "onActiveKeyChanged">
): Promise<ClearByokKeyResult> {
  try {
    try {
      deps.fileIO.remove();
    } catch {
      return failure("internal_error");
    }

    const active = resolveActiveKeySource(deps);
    deps.onActiveKeyChanged?.(active);
    return { ok: true, configured: active.source !== "none", source: active.source };
  } catch {
    return failure("internal_error");
  }
}
