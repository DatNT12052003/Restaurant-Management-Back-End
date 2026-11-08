import app from "./app";
import http from "http";
import dotenv from "dotenv";
import { initSocket } from "./sockets";
import { pool } from "./config/db";
import { startScheduledJobs } from "./cronjob";
import { assertJwtSecrets } from "./utils/jwt";

dotenv.config();

const PORT = process.env.PORT || 3000;

// Sau reverse proxy (nginx...): đặt TRUST_PROXY (ví dụ "1") để req.ip là IP thật của client (rate limit, audit log)
if (process.env.TRUST_PROXY) app.set("trust proxy", Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);

const server = http.createServer(app);

const startServer = async () => {
    try {
        assertJwtSecrets();
        await pool.query("SELECT 1");
        console.log("Connected to PostgreSQL");

        initSocket(server);
        startScheduledJobs();

        server.listen(PORT, () => {
            console.log(`Server running on port ${PORT}`);
        });
    } catch (error) {
        console.error("Database connection failed:", error);
    }
};

startServer();
