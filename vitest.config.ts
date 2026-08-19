import { defineConfig } from "vitest/config";

export default defineConfig({
  // 与 vite.config.ts 保持一致：测试不读取本地 .env/.env.local。
  envFile: false,
  test: {
    include: ["src/tests/**/*.test.ts"]
  }
});
