import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
    { ignores: ["dist", "logs", "node_modules"] },
    {
        files: ["**/*.ts"],
        extends: [js.configs.recommended, ...tseslint.configs.recommended],
        languageOptions: { globals: globals.node },
        rules: {
            // Service bắt lỗi rồi trả mã lỗi số: biến `error` trong catch thường không dùng
            "@typescript-eslint/no-unused-vars": [
                "error",
                { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none", ignoreRestSiblings: true },
            ],
            // Một số chỗ (dòng DB động, payload Socket) cố ý dùng any; cảnh báo thay vì chặn
            "@typescript-eslint/no-explicit-any": "warn",
            // Quy ước của dự án: `interface IUpdateXBody extends Partial<ICreateXBody> {}`
            "@typescript-eslint/no-empty-object-type": ["error", { allowInterfaces: "always" }],
        },
    },
    {
        // Test đọc response JSON động
        files: ["tests/**/*.ts"],
        rules: { "@typescript-eslint/no-explicit-any": "off" },
    },
);
