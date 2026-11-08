import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
    resolve: {
        alias: { "~": path.resolve(__dirname, "src") },
    },
    test: {
        include: ["tests/**/*.test.ts"],
        globalSetup: ["tests/global-setup.ts"],
        setupFiles: ["tests/setup.ts"],
        // Các file test dùng chung một DB và xóa dữ liệu trước mỗi file -> chạy tuần tự
        fileParallelism: false,
        testTimeout: 30_000,
        hookTimeout: 120_000,
    },
});
