import { Request, Response, NextFunction } from "express";
import logger from "../config/logger";

export const errorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
    logger.error("Unhandled Error", {
        message: err.message,
        stack: err.stack,
        method: req.method,
        url: req.originalUrl,
    });

    res.status(err.status || 500).json({
        message: "Internal Server Error",
    });
};
