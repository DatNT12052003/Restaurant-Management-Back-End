import { afterAll, beforeAll } from "vitest";
import { loadTestEnv } from "./env";

// Phải chạy trước khi import code ứng dụng (config/db.ts đọc biến môi trường lúc import)
loadTestEnv();

beforeAll(async () => {
    const { resetDatabase } = await import("./helpers");
    await resetDatabase();
});

afterAll(async () => {
    const { pool } = await import("~/config/db");
    await pool.end();
});
