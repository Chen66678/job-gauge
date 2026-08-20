# Contributing

感谢你关注本项目。当前版本是 local-first 的 BOSS 直聘岗位雷达，仍处于早期阶段。

## 开发环境

- Node.js 22+
- npm 10+

## 初始化

```bash
# 仓库根目录
npm ci

# 浏览器插件
npm --prefix browser-extension ci
```

插件的 `postinstall` 会执行 `wxt prepare`，生成 `.wxt/` 类型文件；该目录和 `.output/` 均不提交到 Git。

## 常用命令

根目录：

```bash
npm run dev                    # Vite 开发服务器
npm test                       # 运行根项目测试
npm run build                  # tsc + vite build
npm run check                  # test + build
npm run verify:electron
npm run verify:browser-extension
npm run verify:release
```

浏览器插件：

```bash
npm --prefix browser-extension run dev
npm --prefix browser-extension run build
npm --prefix browser-extension run zip
npm --prefix browser-extension test
```

## 提交约定

- 使用 `fix:`、`feat:`、`refactor:`、`chore:`、`docs:` 等 Conventional Commits 前缀。
- 涉及行为变化时，优先补测试。
- 提交前至少运行 `npm run check` 和 `npm run verify:release`。

## 安全边界

- 不要提交任何真实 API Key、配对 token、简历原文或岗位采集日志。
- 本项目测试与构建显式使用 `envFile: false`，不会读取 `.env` / `.env.local`。
- 浏览器插件对 BOSS 页面保持只读采集：不点击、不提交、不导航、不读取 cookie。
- 本地 API 只绑定 `127.0.0.1`，并校验 Host、Origin、回环地址和配对 token。

## 目录速览

- `src/domain/`：领域逻辑，应保持与 Electron/浏览器 API 解耦
- `src/job-list/`：岗位列表的展示组件与视图模型；页面组件只负责状态和流程编排
- `src/*Page.tsx`：React 页面入口；页面专属样式与入口同名并放在 `src/` 下
- `src/index.css`：设计变量、重置、应用外壳和跨页面共享控件，不放页面专属规则
- `electron/`：Electron 主进程、preload、图片渲染
- `browser-extension/`：WXT 浏览器插件
- `scripts/`：验证与评测脚本

新增界面代码时，优先把可独立测试的映射逻辑放入视图模型，把重复或较重的展示块拆成组件，并将样式放在最接近使用方的位置。业务判断仍应落在 `src/domain/`，避免页面、Electron IPC 和浏览器插件各自实现一套规则。
