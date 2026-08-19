# BOSS Local Job Radar

本地优先的 BOSS 直聘岗位雷达：浏览器插件只读采集岗位 JD，本地 Electron 应用完成简历解析、岗位评分、偏好否决、追问补全与定制材料生成。

## 组成

- `src/`：React 渲染层 + 领域逻辑（`src/domain/`）
- `electron/`：Electron 主进程、preload、简历图片渲染
- `browser-extension/`：基于 WXT 的 BOSS 岗位只读采集插件
- `scripts/`：验证脚本与评测脚本

## 核心链路

1. 插件从 BOSS 页面读取当前岗位标题、公司、JD、地址与来源链接。
2. 插件只通过 `127.0.0.1:8765-8767` 把数据 POST 到本地应用。
3. 本地应用抽取 JD 要求与风险，用已确认事实库进行 LLM 语义匹配评分。
4. 硬否决、软偏好与风险惩罚在本地确定性计算。
5. 根据评分生成追问，确认后生成可溯源简历材料，并导出文本/图片/PDF。

## 开发与验证

```bash
npm install
npm run dev
npm test
npm run build
npm run verify:electron
npm run verify:browser-extension
npm run verify:release
```

## 安全边界

- 数据默认只保存在本机；岗位采集只读，不点击、不提交、不导航。
- BYOK API Key 经 Electron `safeStorage` 加密后独立落盘，绝不写入 `CoreState`，也不参与广播。
- 本地 HTTP 服务只绑定 `127.0.0.1`，校验 Host、Origin、回环地址和配对 token 四道防线。
- 渲染层只通过 preload 暴露的最小 API 与主进程通信，不暴露 `ipcRenderer` 或文件路径。

详见 `SECURITY.md`。
