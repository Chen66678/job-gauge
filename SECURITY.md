# 安全说明

## 密钥与凭证

- 用户 API Key 只通过 `coreApi:saveAndVerifyByokKey` IPC 单向传入主进程。
- Key 经 Electron `safeStorage` 加密后写入独立的 `byok-key.enc.json`，使用临时文件 + rename 原子替换。
- Key 明文、密文、来源信息均不进入 `CoreState`，也不通过 `coreState:changed` 广播。
- BYOK 验证失败只返回固定白名单文案，不返回 provider 或底层错误原文。
- 优先级：有效钥匙串 Key > 有效环境变量 Key > 未配置。

## 本地岗位导入 API

- 仅绑定 `127.0.0.1`，按 Host → Origin → 回环地址 → `X-Radar-Token` 顺序校验。
- 请求体上限 2 MB；浏览器插件是唯一的本地导入客户端。
- 配对 token 在 Electron 用户数据目录独立保存，不在 CoreState 或日志中输出。

## 岗位采集边界

- 浏览器插件只读取 BOSS 岗位页面文本，不点击、不提交、不导航、不读取 cookie。
- 插件的唯一网络出口是 background service worker，目标只能是 `127.0.0.1` 的本地 API 端口。

## 上报与修复

发现问题请先确认能否在本地复现。敏感问题优先通过 GitHub Security Advisory（若仓库已启用私有漏洞报告）或维护者私下渠道沟通；不要向公开 issue 附上 API Key、配对 token、简历原文或岗位采集日志。
