import app from "./app";
import http from "http";
import dotenv from "dotenv";
import { initSocket } from "./sockets";
import { pool } from "./config/db";

dotenv.config();

const PORT = process.env.PORT || 3000;

const server = http.createServer(app);

const startServer = async () => {
    try {
        await pool.connect();
        console.log("Connected to PostgreSQL");

        initSocket(server);

        server.listen(PORT, () => {
            console.log(`Server running on port ${PORT}`);
        });
    } catch (error) {
        console.error("Database connection failed:", error);
    }
};

startServer();
