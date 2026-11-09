import { randomUUID } from "crypto";
import { Request, Response, NextFunction } from "express";
import logger from "../config/logger";

/**
 * Ghi log mỗi request. Giai đoạn 14: gắn mã request (`X-Request-Id`, nhận từ reverse proxy nếu có) vào log và response,
 * để lần theo một lỗi từ trình duyệt đến log máy chủ.
 */
export const requestLogger = (req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    const incoming = req.headers["x-request-id"];
    const requestId = typeof incoming === "string" && /^[\w.-]{1,100}$/.test(incoming) ? incoming : randomUUID();
    res.setHeader("X-Request-Id", requestId);

    res.on("finish", () => {
        const duration = Date.now() - start;

        logger.http("HTTP Request", {
            request_id: requestId,
            method: req.method,
            url: req.originalUrl,
            status: res.statusCode,
            duration: `${duration}ms`,
            ip: req.ip,
        });
    });

    next();
};
