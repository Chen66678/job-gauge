import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  // 本项目不依赖 Vite 注入的 .env 文件；显式关闭可避免构建/测试误读本地 .env.local。
  envFile: false,
  plugins: [react()],
});
