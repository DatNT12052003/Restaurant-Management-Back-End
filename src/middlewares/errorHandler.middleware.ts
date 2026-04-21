import { Request, Response, NextFunction } from "express";
import logger from "../config/logger";
import { serverErrorResponse } from "~/common/responses/error";

export const errorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
    logger.error("Unhandled Error", {
        message: err.message,
        stack: err.stack,
        method: req.method,
        url: req.originalUrl,
    });

    serverErrorResponse(res);
};
