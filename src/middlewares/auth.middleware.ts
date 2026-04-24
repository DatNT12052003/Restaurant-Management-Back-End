import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { authenticationErrorResponse, authorizationErrorResponse } from "~/common/responses/error";

export const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;

    if (!authHeader) return authenticationErrorResponse(res, req.t("common:authorization_header_missing"));

    const token = authHeader.split(" ")[1];

    try {
        const payload = jwt.verify(token, process.env.ACCESS_SECRET!) as any;
        req.account = payload;
        next();
    } catch {
        return authorizationErrorResponse(res, req.t("common:invalid_or_expired_token"));
    }
};
