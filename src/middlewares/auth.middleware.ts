import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { authenticationErrorResponse } from "~/common/responses/error";
import { getRolesByUserId } from "~/repositories/role.repository";
import { getUserByAccountId } from "~/repositories/user.repository";

export const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;

    if (!authHeader) return authenticationErrorResponse(res, req.t("common:authorization_header_missing"));

    const token = authHeader.split(" ")[1];

    try {
        const payload = jwt.verify(token, process.env.ACCESS_SECRET!) as NonNullable<Request["account"]>;
        req.account = payload;
        next();
    } catch {
        return authenticationErrorResponse(res, req.t("common:invalid_or_expired_token"));
    }
};

/**
 * Giai đoạn 13: API công khai. Có Bearer token hợp lệ của tài khoản khách (role `guest`) thì gán `req.user`, `req.roles`;
 * không có / sai / hết hạn / không phải khách thì coi như khách vãng lai (không trả 401).
 */
export const optionalGuest = async (req: Request, _res: Response, next: NextFunction) => {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return next();
    try {
        const payload = jwt.verify(token, process.env.ACCESS_SECRET!) as NonNullable<Request["account"]>;
        const user = await getUserByAccountId(payload.account_id);
        if (user && user.status !== "inactive") {
            const roles = await getRolesByUserId(user.id);
            if (roles.includes("guest")) {
                req.account = payload;
                req.user = user;
                req.roles = roles;
            }
        }
    } catch {
        // Bỏ qua: xem như chưa đăng nhập
    }
    next();
};
