import { CorsOptions } from "cors";

const DEFAULT_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173";

/**
 * Danh sách origin, cách nhau bởi dấu phẩy (CORS_ORIGINS); mặc định là Vite dev server.
 * Đọc lúc kiểm tra (không đọc lúc import) vì file này được import trước khi dotenv nạp `.env`.
 */
const allowedOrigins = () =>
    (process.env.CORS_ORIGINS || DEFAULT_ORIGINS)
        .split(",")
        .map((o) => o.trim())
        .filter(Boolean);

const corsOptions: CorsOptions = {
    origin: (origin, callback) => {
        if (!origin || allowedOrigins().includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error("Not allowed by CORS"));
        }
    },
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization", "x-platform"],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
};

export default corsOptions;
