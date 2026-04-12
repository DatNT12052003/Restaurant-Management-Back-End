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

const logger = winston.createLogger({
    levels,
    level: process.env.NODE_ENV === "production" ? "info" : "debug",
    format: process.env.NODE_ENV === "production" ? prodFormat : devFormat,
    transports: [
        new winston.transports.Console(),

        new winston.transports.File({
            filename: `logs/${process.env.NODE_ENV || "dev"}.error.log`,
            level: "error",
        }),

        new winston.transports.File({
            filename: `logs/${process.env.NODE_ENV || "dev"}.combined.log`,
        }),
    ],
});

export default logger;
