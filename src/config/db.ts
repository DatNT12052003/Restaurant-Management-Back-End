import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();

export const pool = new Pool({
    // connectionString: process.env.DATABASE_URL,
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: Number(process.env.DB_PORT),
    ssl: false,
    // ssl: {
    //     rejectUnauthorized: false,
    // },
});
