import { Request, Response, NextFunction } from "express";
import logger from "../config/logger";

export const requestLogger = (req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();

    res.on("finish", () => {
        const duration = Date.now() - start;

        logger.http("HTTP Request", {
            method: req.method,
            url: req.originalUrl,
            status: res.statusCode,
            duration: `${duration}ms`,
            ip: req.ip,
        });
    });

    next();
};
