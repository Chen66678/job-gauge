# CustomResumePage 派工报告

## 1. 简历来源可见
- 简历正文每一行下方增加“来源事实”标签，按该行 `factIds` 精确关联并显示事实标签与最多 96 字的原文摘要；完整原文可通过悬浮提示查看。
- 保留右侧“本次用到的事实”总览及原有展开/收起能力。

## 2. 免重复生成
- 进入页面先通过 `getState()` 查找当前岗位的持久化 `material`：存在则直接展示，不调用 `draftMaterial`。
- 无持久化材料时才自动生成；增加明确的“重新生成”按钮。
- 保留并继续使用 `activeJobIdRef` 的 jobId 一致性检查，异步旧岗位结果不会覆盖新岗位页面；另对自动生成增加同岗位去重。
- 新增页面测试，覆盖已有材料时不生成，以及用户点击后可重新生成。

## 3. PDF 导出
- 新增“导出 PDF”按钮。
- 复用现有 `renderResumeImage` 图片渲染管线，将渲染结果转换为单页 JPEG 嵌入式 PDF 后下载；未新增依赖，也未修改 Electron、`pdfResume.ts` 或领域层文件。

## 验证结果

```text
$ npx tsc --noEmit
# 通过（退出码 0）

$ npx vitest run
Test Files  24 passed (24)
Tests  169 passed (169)
```

注：全量测试期间现有 `JobListPage` 测试会输出重复 React key 的 stderr 警告，但测试全部通过，且与本次改动无关。
