import { spawnSync } from "child_process";
import path from "path";
import { Client } from "pg";
import { loadTestEnv, testDatabaseUrl } from "./env";

/** Chạy một lần trước toàn bộ test: tạo DB test nếu chưa có và chạy migration (gồm seed vai trò / quyền). */
export default async function setup() {
    loadTestEnv();
    const { DB_USER, DB_PASSWORD, DB_HOST, DB_PORT, DB_NAME } = process.env;

    const admin = new Client({ user: DB_USER, password: DB_PASSWORD, host: DB_HOST, port: Number(DB_PORT), database: "postgres" });
    await admin.connect();
    const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [DB_NAME]);
    if (!exists.rowCount) await admin.query(`CREATE DATABASE "${DB_NAME}"`);
    await admin.end();

    const root = path.resolve(__dirname, "..");
    const result = spawnSync(
        process.execPath,
        [path.join(root, "node_modules/tsx/dist/cli.mjs"), path.join(root, "node_modules/node-pg-migrate/bin/node-pg-migrate"), "up"],
        { cwd: root, env: { ...process.env, DATABASE_URL: testDatabaseUrl() }, encoding: "utf8" },
    );
    if (result.status !== 0) {
        throw new Error(`Migration failed:\n${result.stdout}\n${result.stderr}`);
    }
}
