import dotenv from "dotenv";
import path from "path";

/**
 * Nạp biến môi trường cho test: `.env` rồi `.env.test` (ghi đè). Trong CI không có file nào, biến lấy từ workflow.
 * Chặn chạy nếu DB không có hậu tố `_test`: bộ test xóa sạch dữ liệu.
 */
export const loadTestEnv = () => {
    const root = path.resolve(__dirname, "..");
    dotenv.config({ path: path.join(root, ".env"), quiet: true });
    dotenv.config({ path: path.join(root, ".env.test"), override: true, quiet: true });
    process.env.NODE_ENV = "test";
    if (!process.env.DB_NAME?.endsWith("_test")) {
        throw new Error(`Refusing to run tests on database "${process.env.DB_NAME}" (name must end with _test)`);
    }
};

export const testDatabaseUrl = () => {
    const { DB_USER = "", DB_PASSWORD = "", DB_HOST = "localhost", DB_PORT = "5432", DB_NAME = "" } = process.env;
    return `postgres://${encodeURIComponent(DB_USER)}:${encodeURIComponent(DB_PASSWORD)}@${DB_HOST}:${DB_PORT}/${DB_NAME}`;
};
