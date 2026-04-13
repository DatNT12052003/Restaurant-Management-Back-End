import { Request, Response, NextFunction } from "express";
import { HTTP_RESPONSE } from "~/common/http-response";

export const validateCreate = (req: Request, res: Response, next: NextFunction) => {
    if (!req.body || Object.keys(req.body).length === 0) {
        res.status(HTTP_RESPONSE.BAD_REQUEST.statusCode).json({
            success: false,
            statusCode: HTTP_RESPONSE.BAD_REQUEST.statusCode,
            message: HTTP_RESPONSE.BAD_REQUEST.message,
        });
    }
    next();
};

export const validateUpdate = (req: Request, res: Response, next: NextFunction) => {
    if (!req.body || Object.keys(req.body).length === 0) {
        res.status(HTTP_RESPONSE.BAD_REQUEST.statusCode).json({
            success: false,
            statusCode: HTTP_RESPONSE.BAD_REQUEST.statusCode,
            message: HTTP_RESPONSE.BAD_REQUEST.message,
        });
    }
    next();
};
