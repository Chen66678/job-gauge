import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'BOSS JD Reader',
    description: 'Read BOSS Zhipin job details and send to local app',
    version: '1.0.0',
    permissions: ['activeTab', 'tabs', 'storage', 'clipboardWrite'],
    host_permissions: [
      'https://www.zhipin.com/*',
      'http://127.0.0.1:*/*'
    ]
  }
});
