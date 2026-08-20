import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'JobGauge',
    description: '从 BOSS 直聘岗位页面读取职位信息并发送到 JobGauge 桌面应用',
    version: '1.0.0',
    permissions: ['activeTab', 'tabs', 'storage', 'clipboardWrite'],
    host_permissions: [
      'https://www.zhipin.com/*',
      'http://127.0.0.1:*/*'
    ]
  }
});
