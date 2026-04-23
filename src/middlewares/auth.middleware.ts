import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { authenticationErrorResponse, authorizationErrorResponse } from "~/common/responses/error";

export const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;

    if (!authHeader) return authenticationErrorResponse(res, "Authorization header missing");

    const token = authHeader.split(" ")[1];

    try {
        const payload = jwt.verify(token, process.env.ACCESS_SECRET!) as any;
        req.account = payload;
        next();
    } catch {
        return authorizationErrorResponse(res, "Invalid or expired token");
    }
};
