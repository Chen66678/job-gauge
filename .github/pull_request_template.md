## 问题

<!-- 原本存在什么问题？如有 Issue，请在这里关联。 -->

## 解决方案

<!-- 采用了什么方式解决？为什么选择这个方案？ -->

## 修改范围

<!-- 列出受影响的功能或目录，并说明是否存在必要的附带修改。 -->

## 验证结果

<!-- 写明实际运行的命令、手动检查步骤和结果；不适用的项目可以删除。 -->

- [ ] `npm test`
- [ ] `npm run build`
- [ ] `npm --prefix browser-extension test`
- [ ] `npm --prefix browser-extension run build`
- [ ] `npm run verify:release`

## 边界检查

- [ ] 未提交 API Key、配对 token、简历、岗位日志或私人文件
- [ ] 浏览器插件仍保持只读，没有新增点击、投递、消息、导航或 cookie 读取
- [ ] 生成内容仍只使用可追溯的已确认事实
- [ ] Electron preload/IPC 仍只暴露必要能力
- [ ] 没有与本 PR 目标无关的重构、格式化或依赖升级

## 界面变化

<!-- 涉及 UI 时附截图或录屏；没有界面变化请写“无”。 -->
