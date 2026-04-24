import app from "./app";
import dotenv from "dotenv";
import { pool } from "./config/db";

dotenv.config();

const PORT = process.env.PORT || 3000;

const startServer = async () => {
    try {
        await pool.connect();
        console.log("Connected to PostgreSQL");

        app.listen(PORT, () => {
            console.log(`Server running on port ${PORT}`);
        });
    } catch (error) {
        console.error("Database connection failed:", error);
    }
};

startServer();

// Viết nốt cái successResponse với errorResponse đi nhé =)))
