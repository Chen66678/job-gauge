# 真 BYOK · Key 入钥匙串数据契约

## 背景与范围

本契约规定 onboarding step① 中用户输入的真实 API Key 从渲染进程到主进程、经 Electron `safeStorage` 加密持久化、应用重启恢复并用于构造真实 LLM client 的数据边界。本文是**契约先行**产物：只约束后续工程实现的接口、状态、生命周期与安全要求，不包含实现代码。

已拍板结论：真实 API Key 经 Electron `safeStorage` 加密后，依托 macOS 系统钥匙串底层能力保存；界面输入必须通过 IPC 送到主进程，主进程构造真实 LLM client；重启后无需再次输入。

### 现状锚点

- `electron/main.cjs:56`—`electron/main.cjs:61`：`createMainCoreApi()` 目前只读取 `process.env.DASHSCOPE_API_KEY`，没有消费界面输入；未配置时创建 unavailable client。
- `electron/main.cjs:257`—`electron/main.cjs:259`：`app.whenReady()` 时只构造并注册一次 `core`，因此持久化 Key 的启动加载必须发生在 client/core 的初始构造之前或同一初始化链内。
- `src/domain/coreApi.ts:90`：`createCoreApi(deps: { client, storage })` 接收 client 依赖；各模型操作在调用时读取 `deps.client`，例如 `src/domain/coreApi.ts:148`、`src/domain/coreApi.ts:166`、`src/domain/coreApi.ts:196`、`src/domain/coreApi.ts:215`。
- `electron/main.cjs:73`—`electron/main.cjs:82`：通用 IPC invoke 包装器当前原样返回 `error.message`，是 Key 泄露的高风险边界。
- `electron/preload.cjs:7`—`electron/preload.cjs:31`：`coreApi` 仅通过 `contextBridge` 暴露；新增通道必须在这里桥接。
- `src/OnboardingPage.tsx:76`—`src/OnboardingPage.tsx:80`：现有 `verifyKey()` 是 `setTimeout` 与 `key === 'invalid'` 的前端假验证，必须由本契约定义的真实验证替代。
- `src/domain/llmClient.ts:20`—`src/domain/llmClient.ts:27`、`src/domain/llmClient.ts:61`、`src/domain/llmClient.ts:86`、`src/domain/llmClient.ts:154`：已有 `LlmClientConfig`、`OpenAiCompatibleLlmClient`、`completeText` 与 `createLlmClient` 可复用。
- `src/domain/llmClient.ts:230`—`src/domain/llmClient.ts:237`：HTTP 401/403 已映射为 `auth_failed`；真实验证必须复用现有 `completeText`，不得另造 HTTP 探测器。
- `electron/main.cjs:57`：核心状态文件为 `path.join(app.getPath('userData'), 'job-radar', 'core-state.json')`；其校验仅接受 `CoreState`，任何密文或 BYOK 元数据均不得写入其中。

## 1. IPC 通道形状

**现状依据**：`electron/preload.cjs:7`—`electron/preload.cjs:31` 定义渲染进程可访问的 `window.coreApi`；`electron/main.cjs:73`—`electron/main.cjs:82` 定义主进程 `coreApi:<method>` 的注册模式。

### 契约规定

1. 新增的 BYOK 能力归属 `window.coreApi`，并使用既有 `coreApi:<method>` 命名空间；preload 只暴露下列三个最小方法，不暴露 `ipcRenderer`、文件路径、`safeStorage` 或密文。
2. 真实 Key 明文只允许作为 `saveAndVerifyByokKey` 的 IPC **请求参数**从渲染进程到主进程单向传递；该方法及任意其他 IPC **返回值**不得包含 Key 明文、Key 子串、密文、`Buffer`、`ciphertextBase64` 或底层异常原文。
3. `getByokKeyStatus` 只回答“是否已配置”和来源；`clearByokKey` 只返回删除后的状态，均不读取或回传 Key。
4. 新增通道必须纳入 preload 白名单桥接，不能由渲染进程自行拼接任意 channel 名调用。

```ts
/** 渲染进程可见的 TypeScript 契约；API Key 仅出现于请求体。 */
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
  /** 仅用于本次 IPC 请求；主进程完成验证后不得回传或持久化明文。 */
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
  /** 仅固定白名单文案，不承载 provider、请求或底层错误详情。 */
  message: string;
}

export type SaveAndVerifyByokKeyResult = ByokSuccess | ByokFailure;
export type ClearByokKeyResult = ByokSuccess | ByokFailure;

export interface ByokCoreApi {
  saveAndVerifyByokKey(request: SaveAndVerifyByokKeyRequest): Promise<SaveAndVerifyByokKeyResult>;
  getByokKeyStatus(): Promise<ByokKeyStatus>;
  clearByokKey(): Promise<ClearByokKeyResult>;
}
```

对应 IPC 名称固定如下：

| Preload 方法 | IPC channel | 入参 | 返回值 |
| --- | --- | --- | --- |
| `saveAndVerifyByokKey` | `coreApi:saveAndVerifyByokKey` | `SaveAndVerifyByokKeyRequest` | `SaveAndVerifyByokKeyResult` |
| `getByokKeyStatus` | `coreApi:getByokKeyStatus` | 无 | `ByokKeyStatus` |
| `clearByokKey` | `coreApi:clearByokKey` | 无 | `ClearByokKeyResult` |

## 2. `safeStorage` 数据形状

**现状依据**：当前主进程在 `electron/main.cjs:56`—`electron/main.cjs:61` 直接用明文环境变量创建 `createLlmClient({ apiKey })`；`src/domain/llmClient.ts:20`—`src/domain/llmClient.ts:27` 约定 client 创建所需 `apiKey: string`。

### 契约规定

1. 主进程收到非空、`trim()` 后的 Key 后，必须先调用 `safeStorage.isEncryptionAvailable()`。返回 `false` 时，必须返回 `encryption_unavailable` 与固定安全文案，**拒绝验证后的落盘**；不得静默写明文、不得写可逆混淆值、不得回退到 `core-state.json`。
2. 可用时，写入链路固定为：`apiKey: string` → `safeStorage.encryptString(apiKey): Buffer` → `buffer.toString('base64'): string` → UTF-8 JSON 文件。
3. 读取链路固定为：JSON `ciphertextBase64: string` → `Buffer.from(ciphertextBase64, 'base64'): Buffer` → `safeStorage.decryptString(buffer): string`。解密得到的字符串只可留在主进程内存中，用于构造/替换 client；不得发送给渲染进程。
4. JSON 的 schema 与字段名固定，禁止把 `Buffer` 直接 JSON 序列化，也禁止增加明文、提示性明文或 Key 指纹字段。

```ts
/** 磁盘上的唯一允许格式：UTF-8 编码 JSON。 */
export interface ByokKeyEncryptedRecordV1 {
  version: 1;
  ciphertextBase64: string;
}
```

有效示例仅说明形状，`ciphertextBase64` 必须是 `safeStorage.encryptString()` 产出的 `Buffer` 经 Base64 编码后的密文：

```json
{"version":1,"ciphertextBase64":"<base64-of-safeStorage-encrypted-buffer>"}
```

## 3. 存放位置与隔离

**现状依据**：`electron/main.cjs:57` 已将核心业务状态放于 `app.getPath('userData')/job-radar/core-state.json`，且该文件仅接受 `CoreState`。

### 契约规定

1. 密文记录固定为独立文件：`path.join(app.getPath('userData'), 'job-radar', 'byok-key.enc.json')`。
2. `byok-key.enc.json` 的内容必须完全符合第 2 节 `ByokKeyEncryptedRecordV1`，不包含业务状态。
3. `core-state.json` 只能保存既有 `CoreState`：禁止新增 `apiKey`、`ciphertextBase64`、`byok`、Key 状态、任何加密材料或任何可从 Key 推导出的字段。
4. 不得将 Key 明文或密文写入偏好设置、诊断输出、临时 state、崩溃报告、下载导出物或渲染进程存储（包括 `localStorage` / `sessionStorage`）。

## 4. 读写时机与生命周期

**现状依据**：`electron/main.cjs:257`—`electron/main.cjs:259` 在 `app.whenReady()` 只创建一次 core；`src/OnboardingPage.tsx:76`—`src/OnboardingPage.tsx:80` 是当前 step① 的验证入口。

### 契约规定

#### 启动读取

1. 在 `app.whenReady()` 初始化链中、首次构造真实 client/core 之前，主进程必须解析环境变量与 `byok-key.enc.json`，按第 5 节优先级选出有效 Key。
2. 若选择钥匙串记录，必须先确认 `safeStorage.isEncryptionAvailable()`，再读取、校验 schema、Base64 解码并解密；仅在解密成功且结果非空时用于 `createLlmClient`。
3. 文件不存在表示“未配置钥匙串 Key”，不是错误；损坏、schema 不匹配、Base64 无效、无法解密或解密为空表示“钥匙串 Key 不可用”，不得使用其中任何数据，也不得将原始异常暴露给 renderer。工程实现应让 status 为未配置/不可用的安全状态，并可记录**不含敏感信息**的内部诊断码。

#### Step① 写入

1. 渲染进程点击验证时调用 `saveAndVerifyByokKey({ apiKey })`；空白 Key 必须在主进程以 `invalid_input` 拒绝，不能只依赖前端校验。
2. 主进程必须先以该请求 Key 创建现有 LLM client，并按第 7 节完成真实 `completeText` 轻量探测。
3. **只有探测成功后**，才加密并以第 2 节格式原子替换 `byok-key.enc.json`，再按第 6 节使运行中 core 切换到该 client，最后返回 `{ ok: true, configured: true, source: 'keychain' }`。
4. 探测失败、加密不可用或写盘失败时，不得写入/替换旧密文，不得切换运行中 client；返回白名单错误结果。

#### 清除

1. 用户调用 `clearByokKey()` 时，主进程删除 `byok-key.enc.json`；删除成功后必须按第 5 节重新解析有效来源并按第 6 节切换 client。
2. 删除后，若环境变量仍有效，则运行中 client 切换为环境变量 client，返回 `{ ok: true, configured: true, source: 'environment' }`；若不存在有效环境变量，则切换为 unavailable client，返回 `{ ok: true, configured: false, source: 'none' }`。
3. 删除不存在的文件应幂等地视为成功，并执行同样的来源重算；不得把文件系统原始错误透传到 renderer。

## 5. Key 来源优先级

**现状依据**：`electron/main.cjs:58`—`electron/main.cjs:59` 当前唯一来源是 `process.env.DASHSCOPE_API_KEY`。

### 契约规定

优先级固定为：**有效钥匙串 Key > 有效 `process.env.DASHSCOPE_API_KEY` > unavailable client**。

理由：钥匙串 Key 是此设备用户通过 step① 主动验证并持久化的显式个人配置；它应覆盖启动环境可能遗留、共享、由开发工具注入或与当前用户不匹配的环境变量。环境变量保留为未设置 BYOK 时的兼容/开发兜底，而不是覆盖用户已确认的 BYOK 选择。

“有效”定义如下：钥匙串 Key 必须可读取、符合第 2 节 schema、可 Base64 解码、可由当前 `safeStorage` 解密且结果非空；环境变量必须存在且 `trim()` 后非空。环境变量不需要在启动时额外探测；后续真实请求仍遵循现有 client 错误分类。

## 6. Client 重建与热替机制

**现状依据**：`src/domain/coreApi.ts:90` 的依赖对象包含 `client`；模型调用在执行时读取 `deps.client`，包括 `src/domain/coreApi.ts:148`、`src/domain/coreApi.ts:166`、`src/domain/coreApi.ts:196`、`src/domain/coreApi.ts:215` 等。`electron/main.cjs:257`—`electron/main.cjs:259` 则使 core 在启动时被一次性“烘焙”。

### 契约规定

1. 成功保存、启动恢复和用户清除后，主进程必须使**后续发起**的 core 模型操作使用按第 5 节新解析的 client；不得要求用户重启应用。
2. 工程实现可在以下两种符合契约的策略中任选一种，选择不得改变 `core-state.json` 的存储语义：
   - **可变 client 持有者**：传给 `createCoreApi` 的依赖对象保持同一引用，在切换时替换其 `client` 字段。因调用时读取 `deps.client`，后续调用自然取得新 client。
   - **重建 core**：以相同 `storage` 与新 client 重建 `createCoreApi`，并以受控方式替换 handler 所使用的 core 引用。
3. 无论采取哪种策略，已开始的模型请求可继续使用发起时捕获的 client；本契约只保证切换完成后**新开始**的请求使用新 client。
4. client 切换本身不是业务状态变更：不得把 Key、来源或密文加入 `CoreState`，不得借 `broadcastState` 传递该信息。需要展示配置状态时，renderer 通过 `getByokKeyStatus()` 主动查询。

## 7. 真验证流程

**现状依据**：`src/OnboardingPage.tsx:76`—`src/OnboardingPage.tsx:80` 目前是假验证；`src/domain/llmClient.ts:86` 定义已有 `completeText`；`src/domain/llmClient.ts:230`—`src/domain/llmClient.ts:237` 已提供 HTTP 错误分类，401/403 为 `auth_failed`。

### 契约规定

1. 废除 `setTimeout` 和 `key.trim().toLowerCase() === 'invalid'` 作为任何验证依据。step① 的 checking/success/failure 状态必须以 `saveAndVerifyByokKey()` 的真实 IPC 结果为准。
2. 主进程对候选 Key 调用 `createLlmClient({ apiKey })`，并复用该 client 的 `completeText` 发起轻量、无用户隐私、无业务写入的探测。不得新建探测器、不得复制请求协议、不得绕过 `llmClient` 的超时/错误映射。
3. 探测请求的契约输入固定为仅用于连通性验证的短文本，例如：

```ts
{
  system: "Reply with exactly OK.",
  user: "OK"
}
```

探测只以 `completeText` resolve 为成功条件；返回文本不写盘、不展示、不计入业务状态。

4. 探测失败必须将现有 LLM 错误映射收敛为 `ByokErrorCode` 并返回固定中文文案。至少固定以下 renderer 可展示语义：

| 错误码 | 固定展示文案 |
| --- | --- |
| `auth_failed` | `API Key 无效或无权访问模型，请检查后重试。` |
| `network_failure` | `无法连接模型服务，请检查网络后重试。` |
| `timeout` | `验证请求超时，请稍后重试。` |
| `rate_limited` | `模型服务当前限流，请稍后重试。` |
| `invalid_response` | `模型服务返回异常，请稍后重试。` |
| `encryption_unavailable` | `系统钥匙串不可用，无法安全保存 API Key。` |
| `invalid_input` | `请输入 API Key。` |
| `internal_error` | `无法完成 API Key 验证，请稍后重试。` |

5. 除上表白名单文案外，失败响应不得携带 `cause`、`stack`、HTTP URL、请求体、响应体、provider 原始 message 或错误对象序列化内容。

## 8. 脱敏红线（最高优先级）

**现状依据**：`electron/main.cjs:73`—`electron/main.cjs:82` 中 `catch` 现会回传 `error.message`；`electron/main.cjs:65`—`electron/main.cjs:70` 的 `broadcastState` 会向全部窗口广播 state；`electron/main.cjs:57` 指定的 `core-state.json` 是业务状态文件。

### 契约规定

以下规则优先级高于便捷调试、错误可读性与任何既有 invoke 包装习惯：

1. **明文禁止面**：API Key 明文不得出现在磁盘文件、日志、控制台、IPC 返回值、异常消息、错误横幅、toast、`CoreState`、`broadcastState` payload、崩溃报告、遥测、测试快照或任何 renderer 可读存储。唯一允许的明文驻留范围是 renderer 输入控件内及主进程处理该 IPC/构造 client 所必需的短暂内存。
2. **持久化唯一例外**：磁盘上只允许第 2 节定义的 `safeStorage` 密文 JSON；密文不等于可直接展示的数据，禁止回传给 renderer 或写入 `core-state.json`。`safeStorage` 不可用时必须拒绝落盘，绝不保存明文。
3. **IPC invoke 规则**：BYOK 三个 channel 不得使用“catch 后原样 `error.message` 返回”的通用行为。探测、加解密、文件读写、client 构造的所有失败都必须在主进程被捕获，归一化为第 1 节的白名单 `ByokFailure`。任何通用 invoke 包装器若覆盖这些 channel，必须支持该 channel 的安全错误适配，不能先行透传。
4. **错误消息规则**：不得依赖“当前 provider message 恰好不含 Key”。即使已知 `mapHttpError` 的当前 message 不含 Key，也必须只回传固定 `code + message` 白名单；对未知异常统一返回 `internal_error` 固定文案。不得把 `String(error)`、`error.message`、`error.stack`、HTTP headers、request config 或响应 body 拼入任何 UI/IPC 字段。
5. **日志规则**：不得记录 `SaveAndVerifyByokKeyRequest` 原对象、`LlmClientConfig` 原对象、`Buffer`、Base64 密文、解密结果，或任何可能含 Authorization/Key 的异常对象。若必须诊断，只可记录不含用户数据的事件名与白名单错误码，例如 `byok_verify_failed: auth_failed`。
6. **状态广播规则**：`broadcastState(core)` 只能发送既有 `core.api.getState()` 的 `CoreState`；不得因保存/清除 Key 而将 Key、密文、来源、探测文本、错误原文或任何安全材料注入 state。BYOK 配置状态通过第 1 节查询接口单独取得。
7. **接口演进规则**：未来新增 BYOK IPC、菜单、诊断或迁移逻辑时，均继承本节；若接口需要返回“已配置”信息，只能复用布尔值和 `ByokKeySource`，不得添加 mask、长度、后缀、哈希、指纹或其他可用于关联/猜测 Key 的字段。

## 已定案（首席裁定 2026-07-26）

以下四项 UI 层细节由首席于 2026-07-26 裁定；均不改变本契约已定的 IPC、删除、加密语义与任何安全边界。

1. **清除入口与文案**：清除入口只在偏好/设置页放一处，文案固定为「清除本地 API Key」；onboarding step① 不放清除入口。
   - 首席理由：清除是低频且不可逆的破坏性操作，收敛到设置页单一入口可避免新用户在首次配置时误触。
2. **钥匙串记录损坏的用户提示**：启动时检测到 `byok-key.enc.json` 损坏/无法解密，不主动弹窗；`getByokKeyStatus()` 静默返回「未配置」，由用户在需要时自行重新配置。提示仍不得含底层错误详情。
   - 首席理由：损坏是罕见边缘情况，静默降级为未配置即可让用户走正常配置流程，主动弹窗只会制造噪音与困惑。
3. **环境变量状态展示**：UI 不展示 `source: 'environment'`，只呈现「已配置 / 未配置」两态。契约仍允许后端查询该来源，但界面不区分、不标注来源。
   - 首席理由：用户不需要关心 Key 来自环境变量还是钥匙串，暴露来源只增加认知负担且逼近泄露风险。
4. **Key 轮换时的并发策略**：保存新 Key 期间禁用提交按钮即可，不额外加「新请求已使用新 Key」之类提示。契约已规定仅保证切换完成后新开始的请求使用新 client。
   - 首席理由：禁用提交按钮已足够防止并发保存竞态，额外提示对用户无实际价值。

以上为 UI 层裁定，不改动 IPC 通道、删除语义、加密语义及第 8 节脱敏红线。
