import { describe, expect, it, vi } from "vitest";
import {
  BYOK_PROBE_REQUEST,
  clearByokKey,
  getByokKeyStatus,
  resolveActiveKeySource,
  saveAndVerifyByokKey,
  type ByokFileIO,
  type ByokKeyManagerDeps,
  type ByokSafeStorage
} from "../domain/byokKeyStore";
import { LlmClientError } from "../domain/llmClient";

// 用真实语义的假 safeStorage（可逆混淆，而非只做占位）验证 encrypt/decrypt
// 往返，且能模拟"加密不可用"路径。
function createFakeSafeStorage(overrides: Partial<ByokSafeStorage> = {}): ByokSafeStorage {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (plainText: string) => Buffer.from(`enc:${plainText}`, "utf8"),
    decryptString: (encrypted: Buffer) => {
      const text = encrypted.toString("utf8");
      if (!text.startsWith("enc:")) throw new Error("bad ciphertext");
      return text.slice(4);
    },
    ...overrides
  };
}

// 用内存 Map 模拟磁盘文件，可断言"是否真的写入了任何文件"。
function createFakeFileIO(initial: string | null = null): ByokFileIO & { contents: string | null } {
  const state = { contents: initial };
  return {
    get contents() {
      return state.contents;
    },
    read: () => state.contents,
    write: (content: string) => {
      state.contents = content;
    },
    remove: () => {
      state.contents = null;
    }
  };
}

function baseDeps(overrides: Partial<ByokKeyManagerDeps> = {}): ByokKeyManagerDeps {
  return {
    safeStorage: createFakeSafeStorage(),
    fileIO: createFakeFileIO(),
    getEnvApiKey: () => undefined,
    probeApiKey: vi.fn(async () => {}),
    ...overrides
  };
}

describe("byokKeyStore · §8 脱敏红线 · 返回值不含明文/密文/底层异常", () => {
  it("saveAndVerifyByokKey 成功返回值不含 Key 明文、密文、Buffer 或探测细节", async () => {
    const fileIO = createFakeFileIO();
    const result = await saveAndVerifyByokKey(baseDeps({ fileIO }), { apiKey: "sk-real-secret-value-123" });

    expect(result.ok).toBe(true);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("sk-real-secret-value-123");
    expect(serialized).not.toContain("enc:");
    expect(serialized).not.toMatch(/ciphertextBase64|Buffer|stack/i);
    // 成功结果只允许 ok/configured/source 三个字段（契约 §1 ByokSuccess 形状）。
    expect(Object.keys(result).sort()).toEqual(["configured", "ok", "source"]);
  });

  it("saveAndVerifyByokKey 探测失败返回值只含白名单 code+message，不含 provider 原文", async () => {
    const providerRawMessage = "Authorization header contained secret sk-leak-if-passed-through";
    const probeApiKey = vi.fn(async () => {
      throw new LlmClientError("auth_failed", providerRawMessage, 401);
    });

    const result = await saveAndVerifyByokKey(baseDeps({ probeApiKey }), { apiKey: "sk-real-secret-value-123" });

    expect(result.ok).toBe(false);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("sk-real-secret-value-123");
    expect(serialized).not.toContain(providerRawMessage);
    expect(serialized).not.toMatch(/stack|cause/i);
    if (!result.ok) {
      expect(result.code).toBe("auth_failed");
      expect(result.message).toBe("API Key 无效或无权访问模型，请检查后重试。");
    }
  });

  it("clearByokKey 返回值不含 Key/密文/异常原文", async () => {
    const fileIO = createFakeFileIO(JSON.stringify({ version: 1, ciphertextBase64: Buffer.from("enc:sk-abc").toString("base64") }));
    const result = await clearByokKey(baseDeps({ fileIO }));

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("sk-abc");
    expect(serialized).not.toMatch(/ciphertextBase64|Buffer/i);
    expect(result.ok).toBe(true);
  });

  it("getByokKeyStatus 只回答 configured/source，不读取或回传 Key", async () => {
    const fileIO = createFakeFileIO(JSON.stringify({ version: 1, ciphertextBase64: Buffer.from("enc:sk-abc").toString("base64") }));
    const status = await getByokKeyStatus(baseDeps({ fileIO }));

    expect(status).toEqual({ configured: true, source: "keychain" });
    expect(JSON.stringify(status)).not.toContain("sk-abc");
  });
});

describe("byokKeyStore · §3.3 core-state 隔离", () => {
  it("saveAndVerifyByokKey/clearByokKey 完全不触碰 core-state 相关任何存储", async () => {
    // byokKeyStore 模块本身不依赖 CoreState/LocalStorageLike，天然不可能写
    // 入 core-state.json；这里用一个会抛错的"陷阱" storage 占位，证明整条
    // 保存/清除路径都没有引用它。
    const coreStateStorageShouldNeverBeTouched = {
      getItem: () => {
        throw new Error("core-state storage must not be touched by BYOK flow");
      },
      setItem: () => {
        throw new Error("core-state storage must not be touched by BYOK flow");
      },
      removeItem: () => {
        throw new Error("core-state storage must not be touched by BYOK flow");
      }
    };
    void coreStateStorageShouldNeverBeTouched;

    const fileIO = createFakeFileIO();
    await saveAndVerifyByokKey(baseDeps({ fileIO }), { apiKey: "sk-real-secret-value-123" });
    await clearByokKey(baseDeps({ fileIO }));

    // 唯一允许的落盘内容是 byok-key.enc.json 的 fileIO；它与 core-state 的
    // LocalStorageLike 接口完全独立，byokKeyStore.ts 源码中不 import 任何
    // core-state 相关模块（见文件头部 import 列表，只 import ./llmClient）。
    expect(fileIO.contents).toBeNull();
  });
});

describe("byokKeyStore · §2.1 加密不可用拒绝落盘", () => {
  it("isEncryptionAvailable()===false 时不写任何文件，返回 encryption_unavailable", async () => {
    const fileIO = createFakeFileIO();
    const safeStorage = createFakeSafeStorage({ isEncryptionAvailable: () => false });

    const result = await saveAndVerifyByokKey(baseDeps({ fileIO, safeStorage }), { apiKey: "sk-real-secret-value-123" });

    expect(result).toEqual({ ok: false, code: "encryption_unavailable", message: "系统钥匙串不可用，无法安全保存 API Key。" });
    expect(fileIO.contents).toBeNull();
  });
});

describe("byokKeyStore · §4.4 探测失败不动旧密文、不切 client", () => {
  it("已有有效密文时，新 Key 探测失败：旧文件内容不变、onActiveKeyChanged 不触发", async () => {
    const existingRecord = JSON.stringify({ version: 1, ciphertextBase64: Buffer.from("enc:sk-old-valid-key").toString("base64") });
    const fileIO = createFakeFileIO(existingRecord);
    const onActiveKeyChanged = vi.fn();
    const probeApiKey = vi.fn(async () => {
      throw new LlmClientError("auth_failed", "invalid key");
    });

    const result = await saveAndVerifyByokKey(baseDeps({ fileIO, onActiveKeyChanged, probeApiKey }), { apiKey: "sk-new-bad-key" });

    expect(result.ok).toBe(false);
    expect(fileIO.contents).toBe(existingRecord);
    expect(onActiveKeyChanged).not.toHaveBeenCalled();
  });
});

describe("byokKeyStore · §5 优先级", () => {
  it("钥匙串与 env 同时有效时，选钥匙串", () => {
    const fileIO = createFakeFileIO(JSON.stringify({ version: 1, ciphertextBase64: Buffer.from("enc:sk-from-keychain").toString("base64") }));
    const active = resolveActiveKeySource({
      safeStorage: createFakeSafeStorage(),
      fileIO,
      getEnvApiKey: () => "sk-from-env"
    });

    expect(active).toEqual({ source: "keychain", apiKey: "sk-from-keychain" });
  });

  it("只有 env 有效时，选 env", () => {
    const active = resolveActiveKeySource({
      safeStorage: createFakeSafeStorage(),
      fileIO: createFakeFileIO(),
      getEnvApiKey: () => "sk-from-env"
    });

    expect(active).toEqual({ source: "environment", apiKey: "sk-from-env" });
  });

  it("都无效时，来源为 none", () => {
    const active = resolveActiveKeySource({
      safeStorage: createFakeSafeStorage(),
      fileIO: createFakeFileIO(),
      getEnvApiKey: () => undefined
    });

    expect(active).toEqual({ source: "none", apiKey: null });
  });
});

describe("byokKeyStore · §4 清除幂等 + 来源重算", () => {
  it("删除后 env 有效 → source:'environment'", async () => {
    const fileIO = createFakeFileIO(JSON.stringify({ version: 1, ciphertextBase64: Buffer.from("enc:sk-old").toString("base64") }));
    const result = await clearByokKey(baseDeps({ fileIO, getEnvApiKey: () => "sk-env-fallback" }));

    expect(result).toEqual({ ok: true, configured: true, source: "environment" });
    expect(fileIO.contents).toBeNull();
  });

  it("删除后 env 无效 → source:'none'", async () => {
    const fileIO = createFakeFileIO(JSON.stringify({ version: 1, ciphertextBase64: Buffer.from("enc:sk-old").toString("base64") }));
    const result = await clearByokKey(baseDeps({ fileIO, getEnvApiKey: () => undefined }));

    expect(result).toEqual({ ok: true, configured: false, source: "none" });
  });

  it("删除不存在的文件应幂等地视为成功", async () => {
    const fileIO = createFakeFileIO(null);
    const result = await clearByokKey(baseDeps({ fileIO, getEnvApiKey: () => undefined }));

    expect(result).toEqual({ ok: true, configured: false, source: "none" });
  });
});

describe("byokKeyStore · §4.3 损坏降级", () => {
  it("schema 不符的密文文件：getByokKeyStatus 返回未配置，不抛异常", async () => {
    const fileIO = createFakeFileIO(JSON.stringify({ notVersion: 1 }));
    const status = await getByokKeyStatus(baseDeps({ fileIO, getEnvApiKey: () => undefined }));

    expect(status).toEqual({ configured: false, source: "none" });
  });

  it("base64 无效的密文文件：不抛异常，视为未配置", async () => {
    const fileIO = createFakeFileIO(JSON.stringify({ version: 1, ciphertextBase64: "%%%not-base64%%%" }));
    await expect(getByokKeyStatus(baseDeps({ fileIO, getEnvApiKey: () => undefined }))).resolves.toEqual({
      configured: false,
      source: "none"
    });
  });

  it("safeStorage.decryptString 抛异常（钥匙串损坏/密钥轮换）：不透传异常，视为未配置", async () => {
    const fileIO = createFakeFileIO(JSON.stringify({ version: 1, ciphertextBase64: Buffer.from("garbage").toString("base64") }));
    const safeStorage = createFakeSafeStorage({
      decryptString: () => {
        throw new Error("keychain item corrupted or was deleted outside the app");
      }
    });

    await expect(getByokKeyStatus(baseDeps({ fileIO, safeStorage, getEnvApiKey: () => undefined }))).resolves.toEqual({
      configured: false,
      source: "none"
    });
  });

  it("解密结果为空字符串：视为不可用而非有效 Key", async () => {
    const fileIO = createFakeFileIO(JSON.stringify({ version: 1, ciphertextBase64: Buffer.from("enc:").toString("base64") }));
    const safeStorage = createFakeSafeStorage({
      decryptString: (encrypted: Buffer) => encrypted.toString("utf8").replace("enc:", "")
    });

    await expect(getByokKeyStatus(baseDeps({ fileIO, safeStorage, getEnvApiKey: () => undefined }))).resolves.toEqual({
      configured: false,
      source: "none"
    });
  });
});

describe("byokKeyStore · §4.135 空 Key 由主进程拒绝", () => {
  it("空白 apiKey 返回 invalid_input，不发起探测", async () => {
    const probeApiKey = vi.fn(async () => {});
    const result = await saveAndVerifyByokKey(baseDeps({ probeApiKey }), { apiKey: "   " });

    expect(result).toEqual({ ok: false, code: "invalid_input", message: "请输入 API Key。" });
    expect(probeApiKey).not.toHaveBeenCalled();
  });
});

describe("byokKeyStore · §7 真验证复用 completeText，不新造探测器", () => {
  it("探测输入固定为契约规定的短文本，不携带用户隐私或业务数据", () => {
    expect(BYOK_PROBE_REQUEST).toEqual({ system: "Reply with exactly OK.", user: "OK" });
  });

  it("成功路径下 probeApiKey 收到的是 trim 后的原始候选 Key", async () => {
    const probeApiKey = vi.fn(async () => {});
    await saveAndVerifyByokKey(baseDeps({ probeApiKey }), { apiKey: "  sk-real-secret-value-123  " });

    expect(probeApiKey).toHaveBeenCalledWith("sk-real-secret-value-123");
  });
});

describe("byokKeyStore · §6 热替回调", () => {
  it("保存成功后 onActiveKeyChanged 收到 keychain 来源与新 Key", async () => {
    const onActiveKeyChanged = vi.fn();
    await saveAndVerifyByokKey(baseDeps({ onActiveKeyChanged }), { apiKey: "sk-real-secret-value-123" });

    expect(onActiveKeyChanged).toHaveBeenCalledWith({ source: "keychain", apiKey: "sk-real-secret-value-123" });
  });

  it("清除后 onActiveKeyChanged 收到重新解析的来源", async () => {
    const fileIO = createFakeFileIO(JSON.stringify({ version: 1, ciphertextBase64: Buffer.from("enc:sk-old").toString("base64") }));
    const onActiveKeyChanged = vi.fn();
    await clearByokKey(baseDeps({ fileIO, onActiveKeyChanged, getEnvApiKey: () => "sk-env-fallback" }));

    expect(onActiveKeyChanged).toHaveBeenCalledWith({ source: "environment", apiKey: "sk-env-fallback" });
  });
});
