import winston from "winston";

const { combine, timestamp, printf, colorize, json } = winston.format;

const levels = {
    error: 0,
    warn: 1,
    info: 2,
    http: 3,
    debug: 4,
};

const devFormat = combine(
    colorize(),
    timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    printf(({ level, message, timestamp, ...meta }) => {
        const metaString = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : "";

        return `[${timestamp}] ${level}: ${message} ${metaString}`;
    }),
);

const prodFormat = combine(timestamp(), json());

/**
 * Giai đoạn 14: trong Docker, log JSON ra stdout để Docker / hệ thống log tập trung thu (đặt `LOG_TO_FILE=false`).
 * `LOG_LEVEL` ghi đè mức log (mặc định info ở production, debug khi phát triển).
 */
const fileTransports =
    process.env.LOG_TO_FILE === "false"
        ? []
        : [
              new winston.transports.File({
                  filename: `logs/${process.env.NODE_ENV || "dev"}.error.log`,
                  level: "error",
              }),
              new winston.transports.File({
                  filename: `logs/${process.env.NODE_ENV || "dev"}.combined.log`,
              }),
          ];

const logger = winston.createLogger({
    // Bộ test: không in log (lỗi vẫn được trả về qua response)
    silent: process.env.NODE_ENV === "test",
    levels,
    level: process.env.LOG_LEVEL || (process.env.NODE_ENV === "production" ? "info" : "debug"),
    format: process.env.NODE_ENV === "production" ? prodFormat : devFormat,
    transports: [new winston.transports.Console(), ...fileTransports],
});

export default logger;
