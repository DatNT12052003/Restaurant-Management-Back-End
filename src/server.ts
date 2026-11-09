import dotenv from "dotenv";
dotenv.config();

import app from "./app";
import http from "http";
import { initSocket } from "./sockets";
import { pool } from "./config/db";
import logger from "./config/logger";
import { flushMonitoring, initMonitoring } from "./config/monitoring";
import { startScheduledJobs } from "./cronjob";
import { assertJwtSecrets } from "./utils/jwt";

initMonitoring();

const PORT = process.env.PORT || 3000;

// Sau reverse proxy (nginx...): đặt TRUST_PROXY (ví dụ "1") để req.ip là IP thật của client (rate limit, audit log)
if (process.env.TRUST_PROXY) app.set("trust proxy", Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);

const server = http.createServer(app);

const startServer = async () => {
    try {
        assertJwtSecrets();
        await pool.query("SELECT 1");
        logger.info("Connected to PostgreSQL");

        const io = initSocket(server);
        startScheduledJobs();

        server.listen(PORT, () => {
            logger.info(`Server running on port ${PORT}`);
        });

        // Giai đoạn 14: Docker gửi SIGTERM khi dừng / triển khai bản mới: ngừng nhận kết nối, chờ request đang chạy rồi thoát
        let stopping = false;
        const shutdown = (signal: string) => {
            if (stopping) return;
            stopping = true;
            logger.info(`${signal} received, shutting down`);
            const force = setTimeout(() => process.exit(1), 10_000);
            force.unref();
            io.close();
            server.close(async () => {
                await pool.end().catch(() => undefined);
                await flushMonitoring();
                process.exit(0);
            });
        };
        process.on("SIGTERM", () => shutdown("SIGTERM"));
        process.on("SIGINT", () => shutdown("SIGINT"));
    } catch (error) {
        logger.error("Server failed to start", { message: (error as Error).message, stack: (error as Error).stack });
        await flushMonitoring();
        // Thoát với mã lỗi để Docker / process manager khởi động lại thay vì treo không phục vụ
        process.exit(1);
    }
};

startServer();
