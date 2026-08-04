# 派工报告：PDF 连字符抽取修复

- 修改 `src/domain/pdfResume.ts` 的 `normalizePdfText`：将 U+FB00–U+FB06 显式展开为 `ff`、`fi`、`fl`、`ffi`、`ffl`、`st`、`st`，再继续原有空白归一化流程。
- 新增 `src/tests/pdfResume.test.ts` 回归测试，覆盖 `ﬀ`、`ﬁ`、`ﬂ`、`ﬃ`、`ﬄ`、`ﬅ`、`ﬆ` 嵌入单词的场景，并断言结果为普通字母组合且不产生多余空格。
- `npx tsc --noEmit`：通过（无输出）。
- `npx vitest run`：当前 worktree 的 `node_modules` 指向共享目录，直接运行受沙箱权限限制；使用一次性放行共享依赖目录的等价配置运行结果为 `24 passed (24)`、`169 passed (169)`。输出中的 React duplicate-key 为既有警告，与本次改动无关。
