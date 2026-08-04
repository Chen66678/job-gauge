# 派工完成报告

## 改动内容

- `src/domain/coreState.ts`：`CoreJobRecord` 新增首次采集时间 `collectedAt` 和过期标记 `evaluationStale`；历史本地状态加载时自动补齐。偏好新增 `autoReevaluateRecentCount`，默认 30。
- `src/domain/coreApi.ts`：简历/偏好保存后，自动重评「所有置顶岗位 + 按 collectedAt 最近 N 条非置顶岗位」；范围外岗位标记过期。新增批量重评、调用次数预估及 N 设置接口。重采岗位保留原 `collectedAt`。
- `electron/main.cjs`、`electron/preload.cjs`、`src/workflowApi.ts`：暴露设置 N、批量重评、调用预估接口。
- `src/SettingsPage.tsx`：增加“自动重评最近 N 条”设置与下次自动重评调用预估。
- `src/ProfilePage.tsx`、`src/PreferencesPage.tsx`：保存前提示本次自动重评岗位数和预计模型调用数，用户确认后执行。
- `src/JobListPage.tsx`、`src/index.css`：过期岗位不显示旧分数，改为灰色“过期”及“评分已过期”角标；列表顶部显示“把剩下 M 条也重评（预计 X 次模型调用）”，点击后需确认。
- 新增/更新测试：覆盖重采不改 `collectedAt`、置顶无条件进入自动重评、超出 N 的非置顶岗位过期、点击“重评剩余”后过期数量清零。

## UI 呈现

过期岗位原有数字分数被隐藏，不会与正常分数同形；评分位置显示灰色“过期”，策略区显示“评分已过期”角标。剩余过期岗位在列表顶部集中显示重评入口，并在点击确认前展示预计模型调用次数。

## 验证结果

```text
$ npx tsc --noEmit
成功（无输出，退出码 0）

$ npx vitest run
Test Files  24 passed (24)
Tests       171 passed (171)
```

备注：现有 `JobListPage` 测试仍会输出既有的 React 重复 key 警告（`TypeScript 经验`），不影响测试通过。
